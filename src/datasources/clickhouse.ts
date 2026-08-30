/**
 * ClickHouse datasource provider over the HTTP interface — pure Node fetch,
 * zero native dependencies, like the reference agent's clickhouse support.
 *
 * The guard parses ClickHouse statements with the MySQL dialect (closest
 * grammar; backtick identifiers coincide). Queries the parser rejects are
 * denied — keep metric/analytics SELECTs parser-friendly.
 *
 * Server-side hardening: run the connection under a ClickHouse `readonly`
 * profile; the SQL guard remains the first line of defense.
 *
 * @module dsh-data-analysis/datasources/clickhouse
 */

import type { ColumnInfo, DataSourceProvider, DataSourceType, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'
import { quoteIdentifier } from '../sql/guard.ts'

export interface ClickhouseConfig {
  /** HTTP base, e.g. http://ck-prod (port defaults to 8123). */
  readonly host: string
  readonly port?: number
  readonly user?: string
  readonly password?: string
  readonly database?: string
}

function inferType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'boolean'
  if (value === null || value === undefined) return 'null'
  return 'json'
}

interface ClickhouseJsonResponse {
  readonly meta?: { name: string, type: string }[]
  readonly data?: Record<string, unknown>[]
  readonly rows?: number
}

export function createClickhouseProvider(name: string, config: ClickhouseConfig): DataSourceProvider {
  const dialect: SqlDialect = 'mysql' // closest parse dialect for the guard
  const base = config.host.replace(/\/+$/, '')
  const url = `${base}:${config.port ?? 8123}/`
  const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' }
  if (config.user !== undefined) headers['X-ClickHouse-User'] = config.user
  if (config.password !== undefined) headers['X-ClickHouse-Key'] = config.password
  const databaseParam = config.database !== undefined ? `&database=${encodeURIComponent(config.database)}` : ''

  async function run(sql: string, signal: AbortSignal | undefined, label: string): Promise<ClickhouseJsonResponse> {
    const response = await fetch(`${url}?default_format=JSON${databaseParam}`, {
      method: 'POST',
      headers,
      body: sql,
      signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`ClickHouse ${label} failed (${response.status}): ${text.slice(0, 400)}`)
    }
    return JSON.parse(text) as ClickhouseJsonResponse
  }

  function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined, label: string): Promise<T> {
    if (signal === undefined) return promise
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error(`${label} aborted by cancellation.`))
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      promise.then(
        (value) => { signal.removeEventListener('abort', abort); resolve(value) },
        (error) => { signal.removeEventListener('abort', abort); reject(error) },
      )
    })
  }

  return {
    name,
    type: 'clickhouse' as DataSourceType,
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      const hardCap = Math.max(1, options.maxRows)
      const result = await raceSignal(
        run(`${sql}\nFORMAT JSON`, options.signal, 'query'),
        options.signal,
        'ClickHouse query',
      )
      const rows = result.data ?? []
      const truncated = rows.length >= hardCap
      const sliced = rows.length > hardCap ? rows.slice(0, hardCap) : rows
      const columns: ColumnInfo[] = (result.meta ?? []).map((field) => ({ name: field.name, type: field.type }))
      const inferred = sliced[0] !== undefined
        ? Object.keys(sliced[0]).map((key) => ({ name: key, type: inferType(sliced[0][key]) }))
        : []
      return {
        columns: columns.length > 0 ? columns : inferred,
        rows: sliced as Record<string, never>[],
        rowCount: typeof result.rows === 'number' ? result.rows : rows.length,
        truncated,
      }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const tableResult = await raceSignal(
        run(`SELECT database, name, engine, total_rows FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') ORDER BY database, name FORMAT JSON`, options.signal, 'introspection'),
        options.signal,
        'ClickHouse introspection',
      )
      const tables = []
      for (const table of (tableResult.data ?? []) as { database: string, name: string, engine: string, total_rows: number | string }[]) {
        const columnResult = await raceSignal(
          run(`SELECT name, type FROM system.columns WHERE database = '${table.database.replace(/'/g, "''")}' AND table = '${table.name.replace(/'/g, "''")}' ORDER BY position FORMAT JSON`, options.signal, 'introspection'),
          options.signal,
          'ClickHouse introspection',
        )
        const qualified = `${quoteIdentifier(table.database, dialect)}.${quoteIdentifier(table.name, dialect)}`
        const samples = options.includeSamples === true
          ? (await raceSignal(run(`SELECT * FROM ${qualified} LIMIT 5 FORMAT JSON`, options.signal, 'introspection'), options.signal, 'ClickHouse introspection')).data ?? []
          : undefined
        const estimated = Number(table.total_rows)
        tables.push({
          name: `${table.database}.${table.name}`,
          type: 'table' as const,
          ...(Number.isFinite(estimated) && estimated > 0 ? { rowCountEstimate: estimated } : {}),
          columns: ((columnResult.data ?? []) as { name: string, type: string }[]).map((column) => ({
            name: column.name,
            dataType: column.type,
          })),
          ...(samples !== undefined ? { samples: samples as Record<string, never>[] } : {}),
        })
      }
      return { datasource: name, dialect, tables, truncated: false }
    },

    async close(): Promise<void> { /* stateless HTTP */ },
  }
}
