/**
 * Shared data-plane types for the RD Data Analysis plugin.
 *
 * Host-side providers produce {@link QueryResult}s; the `render_chart` tool
 * turns model chart intent into a complete ECharts option and emits a durable
 * `rd/chart` session event (see ./events.ts) that the browser half renders.
 *
 * @module dsh-data-analysis/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

export type { JsonValue }

/** Supported datasource engines. `spark` ships a mock plus a real Livy backend (see spark.ts / spark-livy.ts). */
export type DataSourceType = 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark' | 'duckdb'

/** SQL dialect used by the guard parser and introspection. */
export type SqlDialect = 'sqlite' | 'mysql' | 'postgresql' | 'hive'

/** Column metadata for a query result. */
export interface ColumnInfo {
  readonly name: string
  /** Best-effort SQL type name; `unknown` when the driver does not report one. */
  readonly type: string
}

/** One executed query's rows plus shape metadata. */
export interface QueryResult {
  readonly columns: readonly ColumnInfo[]
  readonly rows: readonly Record<string, JsonValue>[]
  /** Rows before the per-source hard row cap. */
  readonly rowCount: number
  readonly truncated: boolean
}

/**
 * The uniform provider seam every engine implements. A real Spark backend
 * (Livy REST or Spark Connect) plugs in here without touching tools, guard,
 * or UI — implement the same interface and register it on the registry.
 */
export interface DataSourceProvider {
  /** Registry key, matches the configured datasource `name`. */
  readonly name: string
  readonly type: DataSourceType
  readonly dialect: SqlDialect
  /** True when the engine is a placeholder (mock Spark) rather than a real backend. */
  readonly mock?: boolean
  /**
   * Execute one guard-validated read-only statement. Implementations enforce
   * their own timeout and must observe `signal` (abort → reject promptly).
   */
  query(sql: string, options: QueryOptions): Promise<QueryResult>
  /** List tables/views with column metadata. */
  introspect(options?: { readonly includeSamples?: boolean, readonly signal?: AbortSignal }): Promise<SchemaInfo>
  /** Release pooled connections. */
  close(): Promise<void>
}

export interface QueryOptions {
  readonly timeoutMs: number
  readonly maxRows: number
  readonly signal?: AbortSignal
}

/** One table (or view) description produced by introspection. */
export interface TableInfo {
  readonly name: string
  readonly type: 'table' | 'view'
  readonly comment?: string
  readonly rowCountEstimate?: number
  readonly columns: readonly {
    readonly name: string
    readonly dataType: string
    readonly nullable?: boolean
    readonly comment?: string
  }[]
  /** First rows sampled per table when introspection asked for samples. */
  readonly samples?: readonly Record<string, JsonValue>[]
}

export interface SchemaInfo {
  readonly datasource: string
  readonly dialect: SqlDialect
  readonly tables: readonly TableInfo[]
  readonly truncated: boolean
}

/**
 * Chart families the render_chart tool can produce.
 * `auto` is accepted by the tool and resolved host-side via `autoChartType()`
 * before an option is built, so the model never has to guess the family.
 */
export type RdChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'heatmap' | 'kpi' | 'boxplot' | 'funnel'
/** Chart types the model may request; `auto` is resolved before option building. */
export type RdChartTypeInput = RdChartType | 'auto'

/** One series mapping for cartesian charts. */
export interface RdSeriesInput {
  /** Data field plotted as values. */
  readonly field: string
  /** Legend name; falls back to `field`. */
  readonly name?: string
}
