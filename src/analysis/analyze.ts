/**
 * Built-in analysis computations over query results (host-side, zero extra
 * dependencies). Each analysis derives one or two READ-ONLY statements from
 * the base SQL, executes them through the datasource provider (which already
 * ran the guard on the base statement — derived statements are plain SELECT
 * wraps), and computes stats in TypeScript. The model interprets the numbers.
 *
 * @module dsh-research/analysis/analyze
 */

import type { QueryResult, SqlDialect } from '../types.ts'
import { GuardError, assertSafeIdentifier } from '../sql/guard.ts'

export type AnalysisKind = 'profile' | 'topn' | 'correlation' | 'distribution'

export interface AnalysisContext {
  readonly dialect: SqlDialect
  /** Run one (already read-only) derived SELECT. */
  run(sql: string): Promise<QueryResult>
}

function mean(values: number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Wrap a guarded SELECT as a derived table for further aggregation. */
function wrap(baseSql: string, alias: string): string {
  // baseSql came through the guard: single SELECT, no trailing semicolon.
  return `SELECT * FROM (\n${baseSql}\n) AS ${alias} LIMIT 20000`
}

/** Column profile: type, nulls, cardinality, numeric stats, top values. */
export async function profile(ctx: AnalysisContext, baseSql: string): Promise<Record<string, unknown>> {
  const result = await ctx.run(wrap(baseSql, 'rd_profile'))
  const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : result.columns.map((c) => c.name)
  const report = columns.map((column) => {
    const values = result.rows.map((row) => row[column])
    const nonNull = values.filter((v) => v !== null && v !== undefined)
    const numeric = nonNull.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[]
    const numbersLike = nonNull.filter((v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    const isNumeric = numeric.length >= numbersLike.length && numeric.length > 0
    const base: Record<string, unknown> = {
      column,
      type: result.columns.find((c) => c.name === column)?.type ?? 'unknown',
      nullCount: values.length - nonNull.length,
      distinct: new Set(nonNull.map((v) => typeof v === 'object' ? JSON.stringify(v) : v)).size,
      sample: nonNull.slice(0, 3).map((v) => typeof v === 'object' ? JSON.stringify(v) : v),
    }
    if (isNumeric) {
      const nums = numeric.length >= numbersLike.length ? numeric : numbersLike.map(Number)
      base.numeric = {
        min: Math.min(...nums),
        max: Math.max(...nums),
        mean: Math.round(mean(nums) * 1000) / 1000,
        median: Math.round(median(nums) * 1000) / 1000,
        stddev: Math.round(stddev(nums) * 1000) / 1000,
      }
    } else {
      const counts = new Map<string, number>()
      for (const value of nonNull) {
        const key = typeof value === 'object' ? JSON.stringify(value) : String(value)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      base.topValues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([value, count]) => ({ value, count }))
    }
    return base
  })
  return { rowsAnalyzed: result.rows.length, rowCountTruncated: result.truncated, columns: report }
}

/** Group-by top-N. */
export async function topn(
  ctx: AnalysisContext,
  baseSql: string,
  options: { dimension: string, metric?: string, aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max', topN?: number },
): Promise<Record<string, unknown>> {
  assertSafeIdentifier(options.dimension, 'dimension column')
  const agg = options.aggregate ?? (options.metric === undefined ? 'count' : 'sum')
  if (agg !== 'count') {
    if (options.metric === undefined) throw new GuardError(`aggregate "${agg}" requires a metric column`)
    assertSafeIdentifier(options.metric, 'metric column')
  }
  const metricExpr = agg === 'count' ? 'COUNT(*)' : `${agg.toUpperCase()}(${options.metric})`
  const limit = Math.min(Math.max(options.topN ?? 10, 1), 100)
  const sql =
    `SELECT ${options.dimension} AS dimension, ${metricExpr} AS value
     FROM (\n${baseSql}\n) AS rd_topn
     GROUP BY ${options.dimension}
     ORDER BY value DESC
     LIMIT ${limit}`
  const result = await ctx.run(sql)
  return {
    dimension: options.dimension,
    aggregate: agg,
    metric: options.metric,
    rows: result.rows,
    truncated: result.truncated,
  }
}

/** Pearson correlation between two numeric columns. */
export async function correlation(
  ctx: AnalysisContext,
  baseSql: string,
  options: { column: string, column2: string },
): Promise<Record<string, unknown>> {
  assertSafeIdentifier(options.column, 'first column')
  assertSafeIdentifier(options.column2, 'second column')
  const sql =
    `SELECT ${options.column} AS a, ${options.column2} AS b
     FROM (\n${baseSql}\n) AS rd_corr`
  const result = await ctx.run(sql)
  const pairs = result.rows
    .map((row) => [Number(row.a), Number(row.b)] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  if (pairs.length < 3) throw new GuardError('Correlation needs at least 3 numeric (x, y) pairs.')
  const xs = pairs.map(([a]) => a)
  const ys = pairs.map(([, b]) => b)
  const mx = mean(xs)
  const my = mean(ys)
  const cov = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0)
  const sx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0))
  const sy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0))
  const r = sx === 0 || sy === 0 ? Number.NaN : cov / (sx * sy)
  return {
    columnA: options.column,
    columnB: options.column2,
    pairs: pairs.length,
    pearsonR: Math.round(r * 10_000) / 10_000,
    strength: Math.abs(r) >= 0.8 ? 'strong' : Math.abs(r) >= 0.5 ? 'moderate' : Math.abs(r) >= 0.3 ? 'weak' : 'negligible',
    direction: r > 0 ? 'positive' : r < 0 ? 'negative' : 'none',
  }
}

/** Histogram of one numeric column. */
export async function distribution(
  ctx: AnalysisContext,
  baseSql: string,
  options: { column: string, buckets?: number },
): Promise<Record<string, unknown>> {
  assertSafeIdentifier(options.column, 'column')
  const sql = `SELECT ${options.column} AS value FROM (\n${baseSql}\n) AS rd_dist`
  const result = await ctx.run(sql)
  const values = result.rows.map((row) => Number(row.value)).filter((v) => Number.isFinite(v))
  if (values.length === 0) throw new GuardError(`Column "${options.column}" has no numeric values to distribute.`)
  const bucketCount = Math.min(Math.max(options.buckets ?? 12, 3), 60)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = (max - min) / bucketCount || 1
  const bins = Array.from({ length: bucketCount }, (_, index) => ({
    from: Math.round((min + index * width) * 1000) / 1000,
    to: Math.round((min + (index + 1) * width) * 1000) / 1000,
    count: 0,
  }))
  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / width), bucketCount - 1)
    bins[index].count++
  }
  return {
    column: options.column,
    samples: values.length,
    min, max,
    mean: Math.round(mean(values) * 1000) / 1000,
    median: Math.round(median(values) * 1000) / 1000,
    stddev: Math.round(stddev(values) * 1000) / 1000,
    bins,
  }
}
