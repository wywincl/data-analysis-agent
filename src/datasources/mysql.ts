/**
 * MySQL datasource provider on `mysql2/promise` (pure JS, connection pool).
 * Credentials come from config (`!!js process.env.*` at the patch layer).
 *
 * The configured MySQL account SHOULD be read-only — the SQL guard is the
 * first line of defense, the account the second. Per-query `timeout` makes
 * mysql2 kill the connection when the statement runs long.
 *
 * @module dsh-research/datasources/mysql
 */

import mysql from 'mysql2/promise'
import type { ColumnInfo, DataSourceProvider, DataSourceType, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'
import { quoteIdentifier } from '../sql/guard.ts'

export interface MysqlConfig {
  readonly host: string
  readonly port?: number
  readonly user?: string
  readonly password?: string
  readonly database: string
  readonly ssl?: boolean
}

function inferType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
  if (typeof value === 'string') return 'text'
  if (value instanceof Date) return 'timestamp'
  if (typeof value === 'bigint') return 'integer'
  if (value === null || value === undefined) return 'null'
  return 'json'
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

export function createMysqlProvider(name: string, config: MysqlConfig): DataSourceProvider {
  const dialect: SqlDialect = 'mysql'
  const pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    // Keep dates as strings so lossless-JSON snapshots stay JSON-safe.
    dateStrings: true,
    decimalNumbers: false,
    supportBigNumbers: true,
  })

  return {
    name,
    type: 'mysql' as DataSourceType,
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      const [rows, fields] = await raceSignal(
        pool.query({ sql, timeout: Math.max(100, options.timeoutMs) }),
        options.signal,
        'MySQL query',
      ) as [unknown, mysql.FieldPacket[]]

      if (!Array.isArray(rows)) {
        throw new Error('MySQL: statement produced no result set (only SELECT is supported).')
      }
      const hardCap = Math.max(1, options.maxRows)
      // Heuristic: with the guard's LIMIT == cap, a full page means more rows may exist.
      const truncated = rows.length >= hardCap
      const sliced = (rows.length > hardCap ? rows.slice(0, hardCap) : rows) as Record<string, unknown>[]
      const columns: ColumnInfo[] = fields.length > 0
        ? fields.map((field) => ({ name: String(field.name), type: String(field.type ?? 'unknown') }))
        : (sliced[0] !== undefined ? Object.keys(sliced[0]).map((key) => ({ name: key, type: inferType(sliced[0][key]) })) : [])
      return {
        columns,
        rows: sliced as Record<string, never>[],
        rowCount: rows.length,
        truncated,
      }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const [tableRows] = await raceSignal(
        pool.query(
          `SELECT table_name AS name, table_type AS kind, table_rows AS est, table_comment AS comment
           FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
          [config.database],
        ),
        options.signal,
        'MySQL introspection',
      ) as [{ name: string, kind: string, est: number | null, comment: string | null }[], mysql.FieldPacket[]]

      const tables = []
      for (const table of tableRows) {
        const [columnRows] = await raceSignal(
          pool.query(
            `SELECT column_name AS name, column_type AS dataType, is_nullable AS nullable, column_comment AS comment
             FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
            [config.database, table.name],
          ),
          options.signal,
          'MySQL introspection',
        ) as [{ name: string, dataType: string, nullable: 'YES' | 'NO', comment: string | null }[], mysql.FieldPacket[]]

        const samples = options.includeSamples === true
          ? (await raceSignal(
            pool.query(`SELECT * FROM ${quoteIdentifier(table.name, dialect)} LIMIT 5`),
            options.signal,
            'MySQL introspection',
          ))[0] as Record<string, never>[]
          : undefined

        tables.push({
          name: table.name,
          type: table.kind === 'VIEW' ? ('view' as const) : ('table' as const),
          ...(table.comment ? { comment: table.comment } : {}),
          ...(typeof table.est === 'number' ? { rowCountEstimate: table.est } : {}),
          columns: columnRows.map((col) => ({
            name: col.name,
            dataType: col.dataType,
            nullable: col.nullable === 'YES',
            ...(col.comment ? { comment: col.comment } : {}),
          })),
          ...(samples !== undefined ? { samples } : {}),
        })
      }
      return { datasource: name, dialect, tables, truncated: false }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
