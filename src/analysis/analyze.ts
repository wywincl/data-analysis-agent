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

export type AnalysisKind = 'profile' | 'topn' | 'correlation' | 'distribution' | 'insight'

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

const TOPN_AGGS = new Set(['count', 'sum', 'avg', 'min', 'max'])

/**
 * Coerce a cell to its numeric value, mapping NULL/empty (which `Number()`
 * would silently turn into 0) to NaN so the finite-filters drop them.
 */
function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return Number.NaN
  return Number(value)
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
    // Columns that store numbers as strings (mysql decimalNumbers:false keeps
    // DECIMAL as text) are numeric too — otherwise an amount column degrades
    // to a categorical top-values list. Require most values to parse so a
    // varchar with occasional digits stays categorical.
    const parsedNumbers = numeric.length >= numbersLike.length
      ? numeric
      : numbersLike.map(Number)
    const isNumeric = parsedNumbers.length > 0 && (numeric.length + numbersLike.length) / nonNull.length >= 0.8
    const base: Record<string, unknown> = {
      column,
      type: result.columns.find((c) => c.name === column)?.type ?? 'unknown',
      nullCount: values.length - nonNull.length,
      distinct: new Set(nonNull.map((v) => typeof v === 'object' ? JSON.stringify(v) : v)).size,
      sample: nonNull.slice(0, 3).map((v) => typeof v === 'object' ? JSON.stringify(v) : v),
    }
    if (isNumeric) {
      base.numeric = {
        min: Math.min(...parsedNumbers),
        max: Math.max(...parsedNumbers),
        mean: Math.round(mean(parsedNumbers) * 1000) / 1000,
        median: Math.round(median(parsedNumbers) * 1000) / 1000,
        stddev: Math.round(stddev(parsedNumbers) * 1000) / 1000,
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
  if (!TOPN_AGGS.has(agg)) {
    // The tool schema declares an enum, but hosts don't all enforce it —
    // validate before the value reaches the derived SQL (defense in depth).
    throw new GuardError(`aggregate "${agg}" is not supported (use count/sum/avg/min/max).`)
  }
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
    .map((row) => [toNumber(row.a), toNumber(row.b)] as const)
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
  const values = result.rows.map((row) => toNumber(row.value)).filter((v) => Number.isFinite(v))
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

/** How many of the largest groups are needed to cover `target` of the total. */
function paretoGroups(rows: { value: number }[], total: number, target: number): number {
  if (total <= 0) return 0
  let running = 0
  for (let index = 0; index < rows.length; index++) {
    running += rows[index].value
    if (running / total >= target) return index + 1
  }
  return rows.length
}

/**
 * Structured "what does this data say" report combining the signals a human
 * analyst reaches for first: headline stats, trend direction, top contributors
 * with share of total, concentration (Pareto), and z-score outliers.
 *
 * The model narrates these numbers instead of re-deriving them from raw rows,
 * which keeps conclusions consistent with the data actually returned.
 */
export async function insight(
  ctx: AnalysisContext,
  baseSql: string,
  options: { dimension?: string, measure?: string, topN?: number },
): Promise<Record<string, unknown>> {
  const topN = Math.min(Math.max(options.topN ?? 5, 1), 50)
  const r3 = (value: number): number => Math.round(value * 1000) / 1000
  const dimension = options.dimension
  if (dimension !== undefined) assertSafeIdentifier(dimension, 'dimension column')

  // Resolve the measure: explicit, else the first mostly-numeric column.
  let measure = options.measure
  if (measure === undefined) {
    const probe = await ctx.run(wrap(baseSql, 'rd_insight_probe'))
    const columns = probe.rows.length > 0 ? Object.keys(probe.rows[0]) : probe.columns.map((c) => c.name)
    measure = columns.find((column) => {
      if (column === dimension) return false
      const values = probe.rows.map((row) => row[column]).filter((v) => v !== null && v !== undefined && v !== '')
      if (values.length === 0) return false
      const numericish = values.filter((v) =>
        typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))))
      return numericish.length / values.length >= 0.8
    })
    if (measure === undefined) {
      throw new GuardError('insight could not find a numeric column to analyze — pass "measure" explicitly.')
    }
  }
  assertSafeIdentifier(measure, 'measure column')

  // Row-grain stats over the measure.
  const raw = await ctx.run(`SELECT ${measure} AS value FROM (\n${baseSql}\n) AS rd_insight_raw`)
  const values = raw.rows.map((row) => toNumber(row.value)).filter((v) => Number.isFinite(v))
  if (values.length === 0) throw new GuardError(`Column "${measure}" has no numeric values to summarize.`)

  const total = values.reduce((sum, v) => sum + v, 0)
  const avg = mean(values)
  const sd = stddev(values)
  const sorted = [...values].sort((a, b) => a - b)
  const summary = {
    rows: values.length,
    total: r3(total),
    mean: r3(avg),
    median: r3(median(values)),
    stddev: r3(sd),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }

  // Outliers at row grain (|z| >= 2).
  const anomalies = values
    .map((value) => ({ value: r3(value), zScore: sd === 0 ? 0 : r3((value - avg) / sd) }))
    .filter((entry) => Math.abs(entry.zScore) >= 2)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
    .slice(0, 10)

  // Trend: first half vs last half of the rows (assumes an ordered base query).
  let trend: Record<string, unknown> | undefined
  if (values.length >= 4) {
    const half = Math.floor(values.length / 2)
    const first = values.slice(0, half)
    const second = values.slice(values.length - half)
    const firstAvg = mean(first)
    const secondAvg = mean(second)
    const changePct = firstAvg === 0
      ? (secondAvg === 0 ? 0 : 100)
      : ((secondAvg - firstAvg) / Math.abs(firstAvg)) * 100
    trend = {
      basis: `first ${half} vs last ${half} rows — meaningful when the base query is ordered by time`,
      firstHalfAvg: r3(firstAvg),
      secondHalfAvg: r3(secondAvg),
      changePct: r3(changePct),
      direction: changePct > 2 ? 'up' : changePct < -2 ? 'down' : 'flat',
    }
  }

  // Grouped view: contributors, concentration and Pareto coverage.
  let topContributors: Record<string, unknown>[] | undefined
  let concentration: Record<string, unknown> | undefined
  if (dimension !== undefined) {
    const grouped = await ctx.run(
      `SELECT ${dimension} AS dimension, SUM(${measure}) AS value, COUNT(*) AS count
       FROM (\n${baseSql}\n) AS rd_insight_grp
       GROUP BY ${dimension}
       ORDER BY value DESC`,
    )
    const rows = grouped.rows
      .map((row) => ({ dimension: row.dimension, value: toNumber(row.value) }))
      .filter((row) => Number.isFinite(row.value))
    const groupTotal = rows.reduce((sum, row) => sum + row.value, 0)
    if (rows.length > 0) {
      topContributors = rows.slice(0, topN).map((row) => ({
        dimension: row.dimension,
        value: r3(row.value),
        share: groupTotal === 0 ? 0 : r3(row.value / groupTotal),
      }))
      const covered = (count: number): number => rows.slice(0, count).reduce((sum, row) => sum + row.value, 0)
      const used = Math.min(topN, rows.length)
      concentration = {
        groups: rows.length,
        top1Share: groupTotal === 0 ? 0 : r3(covered(1) / groupTotal),
        topNGroups: used,
        topNShare: groupTotal === 0 ? 0 : r3(covered(used) / groupTotal),
        pareto80Groups: paretoGroups(rows, groupTotal, 0.8),
      }
    }
  }

  return {
    measure,
    ...(dimension !== undefined ? { dimension } : {}),
    summary,
    ...(trend !== undefined ? { trend } : {}),
    ...(topContributors !== undefined ? { topContributors } : {}),
    ...(concentration !== undefined ? { concentration } : {}),
    anomalies,
  }
}
