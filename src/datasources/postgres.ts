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
  /** Skip the TLS certificate check (self-signed certs). Default: verify. */
  readonly sslSkipVerify?: boolean
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

/** Per-query wait bound: external cancel plus the caller's timeoutMs. */
function boundSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const signals = [
    ...(signal !== undefined ? [signal] : []),
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? [AbortSignal.timeout(timeoutMs)] : []),
  ]
  return signals.length > 0 ? AbortSignal.any(signals) : AbortSignal.timeout(60_000)
}

export function createPostgresProvider(name: string, config: PostgresConfig): DataSourceProvider {
  const dialect: SqlDialect = 'postgresql'
  const pool = new pg.Pool({
    host: config.host,
    port: config.port ?? 5432,
    user: config.user,
    password: config.password,
    database: config.database,
    // TLS on means VERIFY by default — an encrypted-but-unchecked channel
    // invites MITM; opting out requires the explicit sslSkipVerify flag.
    ssl: config.ssl === true ? { rejectUnauthorized: config.sslSkipVerify !== true } : undefined,
    max: 4,
    // Server-side guardrails; pg times are milliseconds. Per-query timeouts
    // additionally scope statement_timeout via SET LOCAL in a transaction.
    statement_timeout: 60_000,
    query_timeout: 60_000,
    idleTimeoutMillis: 30_000,
  })

  return {
    name,
    type: 'postgres' as DataSourceType,
    dialect,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.floor(options.timeoutMs) : 60_000
      const client = await raceSignal(pool.connect(), boundSignal(options.signal, timeoutMs), 'PostgreSQL connect')
      try {
        // statement_timeout is session-scoped on a pooled client, so a bare
        // SET would leak into the next borrower. Inside an explicit
        // transaction SET LOCAL scopes it to exactly this statement.
        await raceSignal(client.query('BEGIN'), boundSignal(options.signal, timeoutMs), 'PostgreSQL query')
        await raceSignal(client.query(`SET LOCAL statement_timeout = ${timeoutMs}`), boundSignal(options.signal, timeoutMs), 'PostgreSQL query')
        const result = await raceSignal(
          client.query({ text: sql }) as unknown as Promise<pg.QueryResult<Record<string, unknown>>>,
          boundSignal(options.signal, timeoutMs),
          'PostgreSQL query',
        )
        await raceSignal(client.query('COMMIT'), boundSignal(options.signal, timeoutMs), 'PostgreSQL query')
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
      } catch (error) {
        await client.query('ROLLBACK').catch(() => { /* connection may be dead */ })
        throw error
      } finally {
        client.release()
      }
    },

    async introspect(options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal } = {}): Promise<SchemaInfo> {
      const tableResult = await raceSignal(
        pool.query(
          `SELECT c.table_schema, c.table_name, c.table_type,
                  obj_description(format('%s.%s', c.table_schema, c.table_name)::regclass) AS comment,
                  COALESCE(rel.reltuples::bigint, 0) AS est
           FROM information_schema.tables c
           LEFT JOIN pg_class rel ON rel.oid = to_regclass(format('%s.%s', c.table_schema, c.table_name))
           WHERE c.table_schema NOT IN ${SYSTEM_SCHEMAS}
           ORDER BY c.table_schema, c.table_name`,
        ),
        options.signal,
        'PostgreSQL introspection',
      )
      // One pass for ALL columns: a per-table loop costs one round trip per
      // table, which is seconds on a warehouse with hundreds of tables.
      const columnResult = await raceSignal(
        pool.query(
          `SELECT table_schema, table_name, column_name, data_type, is_nullable,
                  col_description(format('%s.%s', table_schema, table_name)::regclass, ordinal_position) AS comment
           FROM information_schema.columns
           WHERE table_schema NOT IN ${SYSTEM_SCHEMAS}
           ORDER BY table_schema, table_name, ordinal_position`,
        ),
        options.signal,
        'PostgreSQL introspection',
      )
      const columnsByTable = new Map<string, { name: string, dataType: string, nullable: boolean, comment?: string }[]>()
      for (const col of columnResult.rows as { table_schema: string, table_name: string, column_name: string, data_type: string, is_nullable: string, comment: string | null }[]) {
        const key = `${col.table_schema}.${col.table_name}`
        const list = columnsByTable.get(key) ?? []
        list.push({
          name: col.column_name,
          dataType: col.data_type,
          nullable: col.is_nullable === 'YES',
          ...(col.comment ? { comment: col.comment } : {}),
        })
        columnsByTable.set(key, list)
      }

      const tables = []
      for (const table of tableResult.rows as { table_schema: string, table_name: string, table_type: string, comment: string | null, est: string }[]) {
        const qualified = `${quoteIdentifier(table.table_schema, dialect)}.${quoteIdentifier(table.table_name, dialect)}`
        const samples = options.includeSamples === true
          ? (await raceSignal(pool.query(`SELECT * FROM ${qualified} LIMIT 5`), options.signal, 'PostgreSQL introspection')).rows
          : undefined
        const key = `${table.table_schema}.${table.table_name}`
        tables.push({
          name: key,
          type: table.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
          ...(table.comment ? { comment: table.comment } : {}),
          ...(Number(table.est) > 0 ? { rowCountEstimate: Number(table.est) } : {}),
          columns: columnsByTable.get(key) ?? [],
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
