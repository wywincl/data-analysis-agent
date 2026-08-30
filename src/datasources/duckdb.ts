/**
 * DuckDB datasource provider.
 *
 * DuckDB is the natural "query anything" engine for this plugin: it reads
 * Parquet/CSV/JSON directly and speaks a SQLite-flavored SQL the read-only
 * guard already understands (`dialect: 'sqlite'`). The native `duckdb-async`
 * driver is optional — it is imported lazily on first use, so the plugin
 * builds, loads, and runs every other datasource even when the driver (a
 * native build) is not installed. A query against an uninstalled driver
 * fails fast with a clear install hint rather than a cryptic native crash.
 *
 * @module dsh-rd-data-analysis/datasources/duckdb
 */

import type { ColumnInfo, DataSourceProvider, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'

/** Infer a display type from a row value (duckdb reports types, but be safe). */
function inferType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'bigint') return 'integer'
  if (typeof value === 'boolean') return 'boolean'
  if (value === null || value === undefined) return 'null'
  return 'json'
}

function columnsFromRows(rows: readonly Record<string, unknown>[]): ColumnInfo[] {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).map((key) => {
    const present = rows.find((row) => row[key] !== null && row[key] !== undefined)
    return { name: key, type: inferType(present?.[key]) }
  })
}

/** DuckDB connection object shape (duckdb-async Database). */
type DuckdbConnection = Record<string, (sql: string, ...rest: unknown[]) => Promise<unknown>>

/** Load the (optional) native driver, surfacing a clear hint when absent. */
async function loadDuckdb(): Promise<{ Database: new (path: string) => PromiseLike<unknown> & DuckdbConnection }> {
  try {
    // Optional native dependency — resolved dynamically so the plugin never
    // requires it at build/load time. The specifier is kept in a variable to
    // defeat static module resolution (and its missing-types error).
    const specifier = 'duckdb-async'
    const mod: unknown = await import(/* @vite-ignore */ specifier)
    const Database = (mod as { Database?: unknown }).Database
    if (typeof Database !== 'function') {
      throw new Error('duckdb-async module loaded but exports no Database constructor.')
    }
    return { Database: Database as new (path: string) => PromiseLike<unknown> & DuckdbConnection }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`DuckDB driver not installed (${reason}). Install it with \`npm i duckdb-async\` (native build) to enable the duckdb datasource.`)
  }
}

export function createDuckdbProvider(name: string, file?: string): DataSourceProvider {
  const dialect: SqlDialect = 'sqlite'
  let dbPromise: Promise<DuckdbConnection> | undefined

  async function getDb(): Promise<DuckdbConnection> {
    if (dbPromise === undefined) {
      dbPromise = (async () => {
        const { Database } = await loadDuckdb()
        const db = new Database(file && file.length > 0 ? file : ':memory:')
        // duckdb-async Database resolves once the underlying connection opens.
        return (await db) as DuckdbConnection
      })()
    }
    return dbPromise
  }

  return {
    name,
    type: 'duckdb',
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      if (options.signal?.aborted) throw new Error('Query aborted before execution.')
      const db = await getDb()
      const all = (await db.all(sql)) as Record<string, unknown>[]
      const hardCap = Math.max(1, options.maxRows)
      const truncated = all.length >= hardCap
      const rows = (all.length > hardCap ? all.slice(0, hardCap) : all) as Record<string, never>[]
      return { columns: columnsFromRows(all), rows, rowCount: all.length, truncated }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const db = await getDb()
      let tableNames: string[] = []
      try {
        const shown = (await db.all(`SHOW TABLES`)) as Record<string, unknown>[]
        // duckdb SHOW TABLES yields a single column; name varies by version.
        tableNames = shown.map((row) => String(Object.values(row)[0] ?? '')).filter((name) => name.length > 0)
      } catch {
        tableNames = []
      }
      const tables = await Promise.all(tableNames.map(async (tableName) => {
        let columns: { name: string, dataType: string }[] = []
        try {
          const described = (await db.all(`DESCRIBE "${tableName}"`)) as { column_name?: string, column_type?: string, Field?: string, Type?: string }[]
          columns = described.map((col) => ({
            name: String(col.column_name ?? col.Field ?? ''),
            dataType: String(col.column_type ?? col.Type ?? 'UNKNOWN'),
          })).filter((col) => col.name.length > 0)
        } catch { /* leave empty */ }
        const samples = options.includeSamples === true
          ? (await db.all(`SELECT * FROM "${tableName}" LIMIT 5`)) as Record<string, never>[]
          : undefined
        return { name: tableName, type: 'table' as const, columns, ...(samples !== undefined ? { samples } : {}) }
      }))
      return { datasource: name, dialect, tables, truncated: false }
    },

    async close(): Promise<void> {
      if (dbPromise === undefined) return
      try {
        const db = await dbPromise
        await (db as { close?: () => Promise<unknown> }).close?.()
      } catch { /* best effort */ }
      dbPromise = undefined
    },
  }
}
