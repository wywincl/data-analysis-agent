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

/**
 * Strip line and block comments so keyword patterns can't hide between
 * whitespace-equivalent tokens: an INTO / OUTFILE pair split by a block
 * comment defeats the raw regex. Only used for the pattern check — the
 * parser sees the original text, so a `--` inside a string literal is
 * unaffected.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
}

/**
 * Rewrite a trailing top-level `LIMIT n` / `LIMIT o, n` / `LIMIT n OFFSET o`
 * so the row count never exceeds `cap`. Returns undefined when the statement
 * does not end with a recognizable LIMIT clause (caller denies — fail closed).
 */
function clampTailLimit(sql: string, cap: number): string | undefined {
  const match = /\blimit\s+(\d+)\s*(?:,\s*(\d+))?\s*(?:offset\s+(\d+))?\s*$/i.exec(sql)
  if (match === null) return undefined
  // MySQL `LIMIT o, n` puts the offset first; the row count is the LAST number.
  const rows = Number.parseInt(match[2] !== undefined ? match[2] : match[1]!, 10)
  if (rows <= cap) return sql
  const head = sql.slice(0, match.index)
  if (match[2] !== undefined) return `${head}LIMIT ${match[1]}, ${cap}`
  if (match[3] !== undefined) return `${head}LIMIT ${cap} OFFSET ${match[3]}`
  return `${head}LIMIT ${cap}`
}

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
  if (DANGEROUS_PATTERN.test(stripSqlComments(sql))) {
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

  // The cap bounds server work, not just what we hold — an existing large
  // LIMIT would materialize before the provider slices, so clamp it too.
  const cap = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : 1
  if (astAny.limit === undefined || astAny.limit === null) {
    return { sql: `${sql} LIMIT ${cap}`, tables }
  }
  const clamped = clampTailLimit(sql, cap)
  if (clamped === undefined) {
    throw new GuardError(`Existing LIMIT could not be clamped to the row cap (${cap}) — lower the LIMIT and retry.`)
  }
  return { sql: clamped, tables }
}
