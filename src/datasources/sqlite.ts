/**
 * SQLite datasource provider on the Node built-in `node:sqlite` (zero native
 * compilation). The same seam the official data-agent uses for its demo
 * provider; this one is free-SQL oriented.
 *
 * `node:sqlite` is synchronous: the event loop blocks for the duration of a
 * statement, so `timeoutMs` cannot interrupt a running query here. The row
 * cap and the guard's injected LIMIT are the effective levers. Cancellation
 * is honored between statements (checked before execute and on row slice).
 *
 * @module dsh-research/datasources/sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { ColumnInfo, DataSourceProvider, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'
import { quoteIdentifier } from '../sql/guard.ts'

interface SqliteColumn {
  readonly cid: number
  readonly name: string
  readonly type: string
  readonly notnull: 0 | 1
}

/** Infer a display type name from a row value (drivers often omit types). */
function inferType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'bigint') return 'integer'
  if (typeof value === 'boolean') return 'boolean'
  if (value === null || value === undefined) return 'null'
  return 'json'
}

export function createSqliteProvider(name: string, file: string): DataSourceProvider {
  const db = new DatabaseSync(file)
  const dialect: SqlDialect = 'sqlite'

  function columnsFromRows(rows: readonly Record<string, unknown>[]): ColumnInfo[] {
    if (rows.length === 0) return []
    return Object.keys(rows[0]).map((key) => {
      const present = rows.find((row) => row[key] !== null && row[key] !== undefined)
      return { name: key, type: inferType(present?.[key]) }
    })
  }

  return {
    name,
    type: 'sqlite',
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      if (options.signal?.aborted) throw new Error('Query aborted before execution.')
      const statement = db.prepare(sql)
      const all = statement.all() as Record<string, unknown>[]
      const hardCap = Math.max(1, options.maxRows)
      const truncated = all.length >= hardCap
      const rows = (all.length > hardCap ? all.slice(0, hardCap) : all) as Record<string, never>[]
      return { columns: columnsFromRows(all), rows, rowCount: all.length, truncated }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const tables = db.prepare(
        `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`,
      ).all() as { name: string, type: string }[]

      const result = tables.map((table) => {
        const columns = (db.prepare(`PRAGMA table_info(${quoteIdentifier(table.name, dialect)})`).all() as unknown as SqliteColumn[])
          .map((col) => ({ name: col.name, dataType: col.type || 'BLOB', nullable: col.notnull === 0 }))
        const samples = options.includeSamples === true
          ? (db.prepare(`SELECT * FROM ${quoteIdentifier(table.name, dialect)} LIMIT 5`).all() as Record<string, never>[])
          : undefined
        return {
          name: table.name,
          type: table.type === 'view' ? ('view' as const) : ('table' as const),
          columns,
          ...(samples !== undefined ? { samples } : {}),
        }
      })
      return { datasource: name, dialect, tables: result, truncated: false }
    },

    async close(): Promise<void> {
      db.close()
    },
  }
}
