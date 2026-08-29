/**
 * SQL guardrail: parse-level read-only enforcement for every statement the
 * model (or a human `/sql`) runs.
 *
 * Policy: SELECT/WITH…SELECT only, single statement, no locking/INTO
 * constructs, top-level LIMIT injected when absent. The provider still slices
 * rows to the per-source hard cap — the injected LIMIT bounds server work,
 * the slice bounds what we hold. Parse failures deny (fail closed).
 *
 * @module dsh-research/sql/guard
 */

import { Parser } from 'node-sql-parser'
import type { SqlDialect } from '../types.ts'

/** Parser dialect per datasource engine. Spark (mock) parses as Hive. */
const PARSER_DIALECT: Record<SqlDialect, 'mysql' | 'postgresql' | 'sqlite' | 'hive'> = {
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite',
  hive: 'hive',
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardError'
  }
}

/** Constructs that are read-only-parseable but not acceptable for an analyst sandbox. */
const DANGEROUS_PATTERN =
  /\b(into\s+(outfile|dumpfile)|for\s+update\b|for\s+share\b|lock\s+in\s+share\s+mode|into\s+@|select\s+.*into\s+(table|var\b))/i

/** Escape one identifier for the given dialect (introspection/analysis SQL). */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  const clean = name.replace(/["'`]/g, '')
  if (dialect === 'mysql') return `\`${clean}\``
  return `"${clean}"`
}

/** Match an unqualified or schema-qualified column/identifier reference. */
export function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)?$/.test(name)
}

/** Validate one user-supplied identifier, throwing a readable error. */
export function assertSafeIdentifier(name: string, what: string): string {
  if (!isSafeIdentifier(name)) throw new GuardError(`Invalid ${what}: "${name}"`)
  return name
}

export interface GuardedSql {
  /** SQL after trailing-semicolon trim and LIMIT injection. */
  readonly sql: string
  /** Table references touched, for audit (`action:db.table` strings). */
  readonly tables: readonly string[]
}

/**
 * Enforce read-only policy and inject a top-level LIMIT when absent.
 * Throws {@link GuardError} with a model-readable reason on any violation.
 */
export function guardSelectOnly(rawSql: string, dialect: SqlDialect, maxRows: number): GuardedSql {
  const sql = rawSql.trim().replace(/;\s*$/, '')
  if (sql.length === 0) throw new GuardError('Empty SQL statement.')
  if (sql.includes(';')) throw new GuardError('Only a single SQL statement is allowed.')
  if (DANGEROUS_PATTERN.test(sql)) {
    throw new GuardError('Rejected: locking / INTO / OUTFILE constructs are not allowed (read-only analyst access).')
  }

  const parserType = PARSER_DIALECT[dialect]
  const parser = new Parser()
  let ast: unknown
  try {
    ast = parser.astify(sql, { type: parserType })
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new GuardError(`SQL failed to parse as ${parserType}: ${reason}. Only a single SELECT statement is supported.`)
  }
  // Multiple statements arrive as an array — deny.
  if (Array.isArray(ast)) throw new GuardError('Only a single SQL statement is allowed.')

  const astAny = ast as { type?: string, limit?: unknown }
  if (astAny.type !== 'select') {
    throw new GuardError(`Only SELECT statements are allowed (got "${astAny.type ?? 'unknown'}").`)
  }

  let tables: string[] = []
  try {
    // node-sql-parser tableList entries are `action::db::table` strings in
    // current typings (older shapes returned arrays); normalize defensively.
    const raw = parser.tableList(sql, { type: parserType }) as unknown as (string | string[])[]
    tables = raw
      .map((entry) => (Array.isArray(entry) ? entry : entry.split('::')))
      .map((parts) => `${parts[0]}:${parts.slice(1).filter((part) => part !== '' && part !== 'null').join('.')}`)
  } catch { /* table listing is advisory */ }
  const mutating = tables.find((t) => !t.startsWith('select:'))
  if (mutating !== undefined) throw new GuardError(`Only read access is allowed (found "${mutating}").`)

  if (astAny.limit === undefined || astAny.limit === null) {
    return { sql: `${sql} LIMIT ${Math.max(1, Math.floor(maxRows))}`, tables }
  }
  return { sql, tables }
}
