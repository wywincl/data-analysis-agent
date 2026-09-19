/**
 * Spark datasource seam + mock provider.
 *
 * v1 ships a MOCK so the whole platform (tools, guard, charts, UI) can be
 * developed and demoed against a Spark-shaped datasource without a cluster.
 * A real backend plugs in by implementing {@link DataSourceProvider} and
 * registering on the registry — recommended paths, in order of practicality:
 *
 *  1. Apache Livy REST (POST /sessions, POST /statements, poll) — pure HTTP,
 *     no native deps; results arrive as JSON text (convert to rows).
 *  2. Spark Connect (Spark 3.4+, gRPC protobuf) — official protocol; needs a
 *     small Python sidecar (pyspark.sql.SparkSession) driven over the
 *     harness' `code-runtime-python` wire protocol or a localhost HTTP bridge.
 *  3. HiveServer2 / Thrift JDBC — legacy clusters; Node Thrift support is
 *     weak, prefer a sidecar with `pyhive`.
 *
 * Long-running statements belong in background work (`ctx.jobs.start`) with
 * result materialization (write to Parquet/CSV, then query the file locally
 * via the sqlite/duckdb path) — never ship big Spark result sets through the
 * conversation.
 *
 * @module dsh-research/datasources/spark
 */

import type { DataSourceProvider, QueryOptions, QueryResult, SchemaInfo, SqlDialect } from '../types.ts'

/** Canned demo schema the mock exposes. */
const MOCK_SCHEMA: SchemaInfo = {
  datasource: 'spark',
  dialect: 'hive',
  truncated: false,
  tables: [
    {
      name: 'orders',
      type: 'table',
      comment: 'mock: order facts (partitioned by dt)',
      rowCountEstimate: 12_500_000,
      columns: [
        { name: 'order_id', dataType: 'bigint' },
        { name: 'user_id', dataType: 'bigint' },
        { name: 'amount', dataType: 'double' },
        { name: 'status', dataType: 'string' },
        { name: 'dt', dataType: 'string', comment: 'partition: yyyy-MM-dd' },
      ],
    },
    {
      name: 'daily_revenue',
      type: 'table',
      comment: 'mock: pre-aggregated revenue per day',
      rowCountEstimate: 730,
      columns: [
        { name: 'dt', dataType: 'string' },
        { name: 'revenue', dataType: 'double' },
        { name: 'orders', dataType: 'bigint' },
      ],
    },
    {
      name: 'users',
      type: 'table',
      comment: 'mock: user dimension',
      rowCountEstimate: 980_000,
      columns: [
        { name: 'user_id', dataType: 'bigint' },
        { name: 'city', dataType: 'string' },
        { name: 'signup_date', dataType: 'string' },
      ],
    },
  ],
}

/** Deterministic pseudo-aggregates so demo charts look alive. */
function mockRows(sql: string): Record<string, unknown>[] {
  const lower = sql.toLowerCase()
  if (lower.includes('daily_revenue')) {
    return Array.from({ length: 14 }, (_, index) => ({
      dt: `2026-08-${String(index + 1).padStart(2, '0')}`,
      revenue: Math.round((120_000 + 40_000 * Math.sin(index * 0.9) + index * 3_000) * 100) / 100,
      orders: 800 + Math.round(200 * Math.cos(index * 0.7)) + index * 5,
    }))
  }
  if (lower.includes('users')) {
    return ['hangzhou', 'shanghai', 'beijing', 'shenzhen', 'chengdu'].map((city, index) => ({
      city, users: 90_000 - index * 12_000,
    }))
  }
  if (lower.includes('orders')) {
    return ['paid', 'shipped', 'refunded', 'pending'].map((status, index) => ({
      status, cnt: 42_000 - index * 9_000,
    }))
  }
  return [{ note: 'spark mock: no canned dataset matches this statement', rows: 0 }]
}

/**
 * Create the mock Spark provider. `delayMs` simulates cluster latency and
 * honors cancellation, exercising the async-provider behavior real backends
 * will have.
 */
export function createSparkMockProvider(name: string, delayMs = 1200): DataSourceProvider {
  const dialect: SqlDialect = 'hive'
  const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Spark query aborted.')) }, { once: true })
  })

  return {
    name,
    type: 'spark',
    dialect,
    mock: true,
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      await sleep(delayMs, options.signal)
      const rows = mockRows(sql).slice(0, Math.max(1, options.maxRows)) as Record<string, never>[]
      const first = mockRows(sql)[0] ?? {}
      return {
        columns: Object.keys(first).map((key) => ({ name: key, type: typeof first[key] === 'number' ? 'double' : 'string' })),
        rows,
        rowCount: rows.length,
        truncated: false,
      }
    },
    async introspect(_options: { readonly includeSamples?: boolean, readonly signal?: AbortSignal } = {}): Promise<SchemaInfo> {
      await sleep(200)
      return { ...MOCK_SCHEMA, datasource: name }
    },
    async close(): Promise<void> { /* nothing pooled */ },
  }
}
