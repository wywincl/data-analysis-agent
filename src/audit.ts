/**
 * Query audit log + cost metering (governance).
 *
 * Every query path the plugin executes — run_sql, analyze_data, query_metric,
 * async jobs, /data-sql — lands here with datasource, SQL, tables touched,
 * row count, duration, the active RLS role, and any error. The store is a
 * bounded in-memory ring buffer (newest last); `/data-history` renders both
 * the recent tail and a per-datasource aggregate (queries, rows, time,
 * errors, and an approximate cost score).
 *
 * Cost model (deliberately transparent, not a price): 1 unit per returned
 * row + 10 units per second of execution, rounded. It ranks query weight
 * well enough to spot runaway scans without pretending to know a bill.
 *
 * @module dsh-data-analysis/audit
 */

export type AuditKind = 'run_sql' | 'query_metric' | 'analyze' | 'async' | 'command'

export interface AuditEntry {
  readonly id: number
  /** ISO timestamp of when the query was issued. */
  readonly at: string
  readonly kind: AuditKind
  readonly datasource: string
  readonly sql: string
  readonly tablesTouched?: readonly string[]
  readonly rowCount?: number
  readonly durationMs: number
  readonly truncated?: boolean
  /** RLS role active at query time ('' when RLS is off). */
  readonly role: string
  readonly error?: string
  /** Free-form provenance: reason, metric name, jobId… */
  readonly meta?: Record<string, string>
}

export interface AuditSummaryRow {
  readonly datasource: string
  readonly queries: number
  readonly rows: number
  readonly totalMs: number
  readonly avgMs: number
  readonly errors: number
  readonly cost: number
}

/** Approximate cost score: 1/row + 10/second. */
export function costUnits(rowCount: number, durationMs: number): number {
  return rowCount + Math.round((durationMs / 1000) * 10)
}

/**
 * Stored SQL is truncated: a model-authored statement can reach hundreds of
 * KB, and the audit is a bounded in-memory ring — without a cap a handful of
 * giant queries would dominate the store. 4 KB keeps table/shape provenance.
 */
const SQL_SNIPPET_LIMIT = 4096

function snippet(sql: string): string {
  return sql.length > SQL_SNIPPET_LIMIT ? `${sql.slice(0, SQL_SNIPPET_LIMIT)}…(+${sql.length - SQL_SNIPPET_LIMIT} chars)` : sql
}

/** Bounded, newest-last in-memory audit log. */
export class QueryAuditStore {
  private readonly entries: AuditEntry[] = []
  private nextId = 1

  constructor(private readonly max: number) {}

  /** Append one entry; returns it (with id + timestamp). No-op when max <= 0 (disabled). */
  record(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry | undefined {
    if (this.max <= 0) return undefined
    const full: AuditEntry = { ...entry, sql: snippet(entry.sql), id: this.nextId++, at: new Date().toISOString() }
    this.entries.push(full)
    while (this.entries.length > this.max) this.entries.shift()
    return full
  }

  /** The newest `n` entries, newest first. */
  recent(n = 20): AuditEntry[] {
    return this.entries.slice(-n).reverse()
  }

  /** All retained entries, oldest first (for tests / exports). */
  all(): readonly AuditEntry[] {
    return this.entries
  }

  /** Per-datasource aggregates over all retained entries, sorted by cost desc. */
  summary(): AuditSummaryRow[] {
    const acc = new Map<string, { queries: number, rows: number, totalMs: number, errors: number, cost: number }>()
    for (const entry of this.entries) {
      const row = acc.get(entry.datasource) ?? { queries: 0, rows: 0, totalMs: 0, errors: 0, cost: 0 }
      row.queries += 1
      row.rows += entry.rowCount ?? 0
      row.totalMs += entry.durationMs
      if (entry.error !== undefined) row.errors += 1
      row.cost += costUnits(entry.rowCount ?? 0, entry.durationMs)
      acc.set(entry.datasource, row)
    }
    return [...acc.entries()].map(([datasource, row]) => ({
      datasource,
      queries: row.queries,
      rows: row.rows,
      totalMs: row.totalMs,
      avgMs: row.queries > 0 ? Math.round(row.totalMs / row.queries) : 0,
      errors: row.errors,
      cost: row.cost,
    })).sort((a, b) => b.cost - a.cost)
  }
}
