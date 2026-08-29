/**
 * PostgreSQL datasource provider on `pg` (pure JS pool). `statement_timeout`
 * is enforced server-side per connection; the configured account should be a
 * read-only role (the SQL guard is the first line of defense, the role the
 * second).
 *
 * @module dsh-research/datasources/postgres
 */

import pg from 'pg'
import type { ColumnInfo, DataSourceProvider, DataSourceType, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'
import { quoteIdentifier } from '../sql/guard.ts'

export interface PostgresConfig {
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

function raceSignal<T>(promise: PromiseLike<T>, signal: AbortSignal | undefined, label: string): Promise<T> {
  const base = Promise.resolve(promise)
  if (signal === undefined) return base
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error(`${label} aborted by cancellation.`))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    base.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`

export function createPostgresProvider(name: string, config: PostgresConfig): DataSourceProvider {
  const dialect: SqlDialect = 'postgresql'
  const pool = new pg.Pool({
    host: config.host,
    port: config.port ?? 5432,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl === true ? { rejectUnauthorized: false } : undefined,
    max: 4,
    // Server-side guardrails; pg times are milliseconds.
    statement_timeout: 60_000,
    query_timeout: 60_000,
    idleTimeoutMillis: 30_000,
  })

  return {
    name,
    type: 'postgres' as DataSourceType,
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      // Pool-level statement_timeout/query_timeout bound server work; the
      // race below bounds what WE wait for (pg typings: query returns a
      // Submittable, cast through unknown to a plain promise).
      const result = await raceSignal(
        pool.query({ text: sql }) as unknown as Promise<pg.QueryResult<Record<string, unknown>>>,
        options.signal,
        'PostgreSQL query',
      )
      const rowsAsObjects = result.rows
      const hardCap = Math.max(1, options.maxRows)
      // Heuristic: with the guard's LIMIT == cap, a full page means more rows may exist.
      const truncated = rowsAsObjects.length >= hardCap
      const sliced = truncated && rowsAsObjects.length > hardCap ? rowsAsObjects.slice(0, hardCap) : rowsAsObjects
      const columns: ColumnInfo[] = result.fields.map((field: pg.FieldDef) => ({ name: field.name, type: String(field.dataTypeID) }))
      const inferred = sliced[0] !== undefined
        ? Object.keys(sliced[0]).map((key) => ({ name: key, type: inferType(sliced[0][key]) }))
        : []
      return {
        columns: columns.length > 0 ? columns : inferred,
        rows: sliced as Record<string, never>[],
        rowCount: rowsAsObjects.length,
        truncated,
      }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo> {
      const tableResult = await raceSignal(
        pool.query(
          `SELECT c.table_schema, c.table_name, c.table_type,
                  obj_description(format('%s.%s', c.table_schema, c.table_name)::regclass) AS comment,
                  COALESCE(rel.reltuples::bigint, 0) AS est
           FROM information_schema.tables c
           LEFT JOIN pg_class rel ON rel.relname = c.table_name
           WHERE c.table_schema NOT IN ${SYSTEM_SCHEMAS}
           ORDER BY c.table_schema, c.table_name`,
        ),
        options.signal,
        'PostgreSQL introspection',
      )

      const tables = []
      for (const table of tableResult.rows as { table_schema: string, table_name: string, table_type: string, comment: string | null, est: string }[]) {
        const columnResult = await raceSignal(
          pool.query(
            `SELECT column_name, data_type, is_nullable,
                    col_description(format('%s.%s', table_schema, table_name)::regclass, ordinal_position) AS comment
             FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [table.table_schema, table.table_name],
          ),
          options.signal,
          'PostgreSQL introspection',
        )
        const qualified = `${quoteIdentifier(table.table_schema, dialect)}.${quoteIdentifier(table.table_name, dialect)}`
        const samples = options.includeSamples === true
          ? (await raceSignal(pool.query(`SELECT * FROM ${qualified} LIMIT 5`), options.signal, 'PostgreSQL introspection')).rows
          : undefined

        tables.push({
          name: `${table.table_schema}.${table.table_name}`,
          type: table.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
          ...(table.comment ? { comment: table.comment } : {}),
          ...(Number(table.est) > 0 ? { rowCountEstimate: Number(table.est) } : {}),
          columns: (columnResult.rows as { column_name: string, data_type: string, is_nullable: string, comment: string | null }[]).map((col) => ({
            name: col.column_name,
            dataType: col.data_type,
            nullable: col.is_nullable === 'YES',
            ...(col.comment ? { comment: col.comment } : {}),
          })),
          ...(samples !== undefined ? { samples: samples as Record<string, never>[] } : {}),
        })
      }
      return { datasource: name, dialect, tables, truncated: false }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
