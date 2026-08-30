/**
 * Apache Livy REST backend for Spark (replaces the built-in mock).
 *
 * Livy exposes a pure-HTTP control plane — no native deps, no JVM in the
 * plugin process — so this plugs into the same {@link DataSourceProvider}
 * seam as every other engine. The HTTP client is injectable so the whole
 * flow (create session → run statement → poll → parse) is unit-testable
 * against a fake client with zero network.
 *
 * Flow per query:
 *   1. POST /sessions            → session id, poll until `state === 'idle'`
 *   2. POST /sessions/{id}/statements  (code = SQL) → statement id
 *   3. GET  /sessions/{id}/statements/{sid}  poll until `state === 'available'`
 *   4. parse `output.data['text/plain']` (a whitespace/pipe table) into rows
 *
 * Spark Connect (gRPC) would implement the same interface with a Python
 * sidecar; Livy is chosen here because it is the lowest-friction real path.
 *
 * @module dsh-data-analysis/datasources/spark-livy
 */

import type { ColumnInfo, DataSourceProvider, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'

/** Minimal HTTP seam so the provider is testable without a live cluster. */
export type LivyHttpClient = (
  method: 'GET' | 'POST',
  url: string,
  opts?: { json?: unknown, headers?: Record<string, string> },
) => Promise<{ status: number, json: unknown, text: string }>

export interface SparkLivyConfig {
  /** Livy base URL, e.g. `http://livy-prod:8998`. */
  livyUrl: string
  /** Run as this proxy user (Livy `proxyUser`). */
  user?: string
  /** YARN queue. */
  queue?: string
  /** Give up waiting on the session / statement after this long. */
  heartbeatTimeoutMs?: number
  /** Poll cadence for session + statement state. */
  pollIntervalMs?: number
  /** Per-statement row cap (the guard also injects LIMIT). */
  maxRows?: number
}

/** Default client backed by the Node global `fetch` (Node 18+). */
export const fetchLivyClient: LivyHttpClient = async (method, url, opts) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    body: opts?.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
  const text = await res.text()
  let json: unknown
  try { json = text.length > 0 ? JSON.parse(text) : undefined } catch { json = undefined }
  return { status: res.status, json, text }
}

/** Parse a Livy SQL `text/plain` table into columns + rows (best-effort). */
export function parseLivyTextTable(text: string): { columns: string[], rows: Record<string, string>[] } {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length === 0) return { columns: [], rows: [] }
  const split = (line: string): string[] => {
    if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim())
    if (line.includes('|')) return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
    return line.split(/\s{2,}/).map((cell) => cell.trim())
  }
  const columns = split(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = split(line)
    const row: Record<string, string> = {}
    columns.forEach((column, index) => { row[column] = cells[index] ?? '' })
    return row
  })
  return { columns, rows }
}

export function createSparkLivyProvider(name: string, config: SparkLivyConfig, http: LivyHttpClient = fetchLivyClient): DataSourceProvider {
  const dialect: SqlDialect = 'hive'
  const timeoutMs = config.heartbeatTimeoutMs ?? 120_000
  const pollMs = config.pollIntervalMs ?? 1_000
  const base = config.livyUrl.replace(/\/$/, '')

  function asRecord(value: unknown): Record<string, unknown> {
    return (value as Record<string, unknown>) ?? {}
  }

  async function createSession(): Promise<number> {
    const res = await http('POST', `${base}/sessions`, {
      json: {
        kind: 'sql',
        ...(config.user !== undefined ? { proxyUser: config.user } : {}),
        ...(config.queue !== undefined ? { queue: config.queue } : {}),
        conf: { 'spark.sql.session.timeZone': 'UTC' },
      },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Livy create session failed (${res.status}): ${res.text}`)
    }
    const id = asRecord(res.json).id
    if (typeof id !== 'number') throw new Error(`Livy create session returned no id: ${res.text}`)
    const started = Date.now()
    // Poll until the session is idle (ready to accept statements).
    for (;;) {
      if (Date.now() - started > timeoutMs) throw new Error('Livy session did not become ready in time.')
      const poll = await http('GET', `${base}/sessions/${id}`)
      const state = String(asRecord(poll.json).state ?? '')
      if (state === 'idle') return id
      if (state === 'dead' || state === 'error') throw new Error(`Livy session ${id} entered ${state}.`)
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  async function runStatement(sessionId: number, sql: string): Promise<{ columns: string[], rows: Record<string, string>[] }> {
    const res = await http('POST', `${base}/sessions/${sessionId}/statements`, { json: { code: sql } })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Livy run statement failed (${res.status}): ${res.text}`)
    }
    const statementId = asRecord(res.json).id
    if (typeof statementId !== 'number') throw new Error(`Livy run statement returned no id: ${res.text}`)
    const started = Date.now()
    for (;;) {
      if (Date.now() - started > timeoutMs) throw new Error('Livy statement did not finish in time.')
      const poll = await http('GET', `${base}/sessions/${sessionId}/statements/${statementId}`)
      const body = asRecord(poll.json)
      const state = String(body.state ?? '')
      if (state === 'available') {
        const output = asRecord(body.output)
        if (String(output.status) === 'error') {
          throw new Error(`Livy statement error: ${String(output.ename ?? '')} ${String(output.evalue ?? JSON.stringify(output.traceback ?? ''))}`)
        }
        const text = String(asRecord(output.data)['text/plain'] ?? '')
        return parseLivyTextTable(text)
      }
      if (state === 'error' || state === 'cancelled') throw new Error(`Livy statement ${statementId} entered ${state}.`)
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  function toQueryResult(parsed: { columns: string[], rows: Record<string, string>[] }, options: QueryOptions): QueryResult {
    const hardCap = Math.max(1, options.maxRows)
    const truncated = parsed.rows.length >= hardCap
    const sliced = parsed.rows.length > hardCap ? parsed.rows.slice(0, hardCap) : parsed.rows
    const columns: ColumnInfo[] = parsed.columns.map((column) => ({ name: column, type: 'string' }))
    return { columns, rows: sliced as Record<string, never>[], rowCount: parsed.rows.length, truncated }
  }

  return {
    name,
    type: 'spark',
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      if (options.signal?.aborted) throw new Error('Query aborted before execution.')
      const sessionId = await createSession()
      try {
        const parsed = await runStatement(sessionId, sql)
        return toQueryResult(parsed, options)
      } finally {
        // Best-effort cleanup; a dead session is harmless and self-expires.
        await http('POST', `${base}/sessions/${sessionId}/kill`).catch(() => {})
      }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const sessionId = await createSession()
      try {
        const shown = await runStatement(sessionId, 'SHOW TABLES')
        const tables = shown.rows.map((row) => String(row[Object.keys(row)[0] ?? ''] ?? ''))
        const result = await Promise.all(tables.map(async (tableName) => {
          const described = await runStatement(sessionId, `DESCRIBE ${tableName}`)
          const columns = described.rows
            .map((row) => ({ name: String(row.col_name ?? ''), dataType: String(row.data_type ?? 'string') }))
            .filter((column) => column.name.length > 0)
          const samples = options.includeSamples === true
            ? (await runStatement(sessionId, `SELECT * FROM ${tableName} LIMIT 5`)).rows as Record<string, never>[]
            : undefined
          return { name: tableName, type: 'table' as const, columns, ...(samples !== undefined ? { samples } : {}) }
        }))
        return { datasource: name, dialect, tables: result, truncated: false }
      } finally {
        await http('POST', `${base}/sessions/${sessionId}/kill`).catch(() => {})
      }
    },

    async close(): Promise<void> { /* sessions are killed per-request */ },
  }
}
