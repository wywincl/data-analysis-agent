/**
 * Host-side ECharts option builder.
 *
 * The model expresses chart INTENT (kind, fields, title); this module builds
 * the complete ECharts option JSON. The model never authors option JSON —
 * that keeps model output small, avoids injection into the render path, and
 * makes the durable `rd/chart` payload deterministic and replay-safe.
 *
 * @module dsh-research/charts/echarts-option
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { RdChartType, RdSeriesInput } from '../types.ts'

/** Numeric coercion mirroring the official renderer's tolerance for string numbers. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'bigint') return Number(value)
  return null
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Tukey box-plot five-number summary of an already sorted sample. */
function quartiles(sorted: number[]): { min: number, q1: number, median: number, q3: number, max: number } {
  const at = (q: number): number => {
    const pos = (sorted.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base
    const next = sorted[base + 1]
    return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base])
  }
  return { min: sorted[0], q1: at(0.25), median: at(0.5), q3: at(0.75), max: sorted[sorted.length - 1] }
}

export interface ChartOptionInput {
  readonly chartType: RdChartType
  readonly title: string
  readonly data: readonly Record<string, JsonValue>[]
  /** Category axis field (line/bar/heatmap) or x field (scatter). */
  readonly xField?: string
  /** Value series fields (line/bar/scatter/heatmap). */
  readonly series?: readonly RdSeriesInput[]
  /** pie: field carrying the slice name; kpi: the single value field. */
  readonly nameField?: string
  /** pie: field carrying the slice value; kpi: the value field. */
  readonly valueField?: string
  /** heatmap: category field for the y axis. */
  readonly yField?: string
  /** kpi: optional display unit. */
  readonly unit?: string
}

const PALETTE = ['#2f6feb', '#12b76a', '#f79009', '#7a5af8', '#ee46bc', '#06aed4', '#e5484d', '#8f8f8f']

function baseOption(title: string): Record<string, JsonValue> {
  return {
    backgroundColor: 'transparent',
    title: { text: title, left: 'left', textStyle: { fontSize: 14, fontWeight: 600 } },
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0, right: 0 },
    grid: { left: 48, right: 24, top: 40, bottom: 40, containLabel: false },
    color: PALETTE,
  }
}

/** Build the complete ECharts option for one chart intent. */
export function buildEchartsOption(input: ChartOptionInput): Record<string, JsonValue> {
  const { chartType, title, data } = input
  if (data.length === 0) throw new Error('No data rows to plot.')

  if (chartType === 'kpi') {
    const field = input.valueField ?? Object.keys(data[0])[0]
    const value = num(data[0][field])
    if (value === null) throw new Error(`KPI requires a numeric field; "${field}" is not numeric in the first row.`)
    return {
      backgroundColor: 'transparent',
      kpi: { value, unit: input.unit ?? '', name: title },
    }
  }

  if (chartType === 'pie') {
    const nameField = input.nameField ?? Object.keys(data[0])[0]
    const valueField = input.valueField ?? Object.keys(data[0])[1] ?? Object.keys(data[0])[0]
    return {
      ...baseOption(title),
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'middle' },
      series: [{
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['42%', '56%'],
        avoidLabelOverlap: true,
        data: data.map((row) => ({ name: cellText(row[nameField]), value: num(row[valueField]) ?? 0 })),
        label: { formatter: '{b}: {d}%' },
      }],
    }
  }

  if (chartType === 'scatter') {
    const xField = input.xField ?? Object.keys(data[0])[0]
    const seriesSpec = input.series && input.series.length > 0 ? input.series : [{ field: Object.keys(data[0])[1] ?? xField }]
    return {
      ...baseOption(title),
      tooltip: { trigger: 'item' },
      xAxis: { type: 'value', scale: true, name: xField },
      yAxis: { type: 'value', scale: true },
      series: seriesSpec.map((spec) => ({
        name: spec.name ?? spec.field,
        type: 'scatter',
        symbolSize: 7,
        data: data.map((row) => [num(row[xField]) ?? 0, num(row[spec.field]) ?? 0]),
      })),
    }
  }

  if (chartType === 'heatmap') {
    const xField = input.xField ?? Object.keys(data[0])[0]
    const yField = input.yField ?? Object.keys(data[0])[1]
    const valueField = input.series?.[0]?.field ?? Object.keys(data[0])[2] ?? Object.keys(data[0])[1]
    const xs = [...new Set(data.map((row) => cellText(row[xField])))]
    const ys = [...new Set(data.map((row) => cellText(row[yField])))].filter((v) => v !== '')
    const values = data.map((row) => [xs.indexOf(cellText(row[xField])), ys.indexOf(cellText(row[yField])), num(row[valueField]) ?? 0])
      .filter((entry) => entry[1] >= 0)
    const maxV = values.reduce<number>((sum, entry) => Math.max(sum, entry[2]), 1)
    return {
      ...baseOption(title),
      tooltip: { position: 'top' },
      grid: { left: 64, right: 24, top: 40, bottom: 56 },
      xAxis: { type: 'category', data: xs, splitArea: { show: true } },
      yAxis: { type: 'category', data: ys, splitArea: { show: true } },
      visualMap: { min: 0, max: maxV, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [{ type: 'heatmap', data: values, label: { show: values.length <= 200 } }],
    }
  }

  if (chartType === 'boxplot') {
    const categoryField = input.xField ?? Object.keys(data[0])[0]
    const valueField = input.series?.[0]?.field ?? input.valueField ?? Object.keys(data[0])[1] ?? Object.keys(data[0])[0]
    const groups = new Map<string, number[]>()
    for (const row of data) {
      const value = num(row[valueField])
      if (value === null) continue
      const key = cellText(row[categoryField])
      const bucket = groups.get(key)
      if (bucket === undefined) groups.set(key, [value])
      else bucket.push(value)
    }
    if (groups.size === 0) throw new Error(`Boxplot requires numeric values in "${valueField}".`)
    const categories: string[] = []
    const boxes: number[][] = []
    for (const [key, values] of groups) {
      if (values.length === 0) continue
      const q = quartiles([...values].sort((a, b) => a - b))
      categories.push(key)
      boxes.push([q.min, q.q1, q.median, q.q3, q.max])
    }
    return {
      ...baseOption(title),
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value', scale: true },
      series: [{
        name: valueField,
        type: 'boxplot',
        data: boxes,
        itemStyle: { borderWidth: 1 },
      }],
    }
  }

  if (chartType === 'funnel') {
    const nameField = input.nameField ?? Object.keys(data[0])[0]
    const valueField = input.valueField ?? input.series?.[0]?.field ?? Object.keys(data[0])[1] ?? Object.keys(data[0])[0]
    return {
      ...baseOption(title),
      tooltip: { trigger: 'item' },
      series: [{
        type: 'funnel',
        left: '12%',
        right: '12%',
        top: 44,
        bottom: 20,
        minSize: '22%',
        sort: 'descending',
        gap: 2,
        label: { show: true, position: 'inside', formatter: '{b}: {c}' },
        data: data.map((row) => ({ name: cellText(row[nameField]), value: num(row[valueField]) ?? 0 })),
      }],
    }
  }

  // line | bar (cartesian, category x)
  const xField = input.xField ?? Object.keys(data[0])[0]
  const seriesSpec = input.series && input.series.length > 0
    ? input.series
    : [{ field: Object.keys(data[0])[1] ?? Object.keys(data[0])[0] }]
  const type = chartType === 'bar' ? 'bar' : 'line'
  return {
    ...baseOption(title),
    xAxis: { type: 'category', data: data.map((row) => cellText(row[xField])), boundaryGap: type === 'bar' },
    yAxis: { type: 'value' },
    series: seriesSpec.map((spec) => ({
      name: spec.name ?? spec.field,
      type,
      smooth: type === 'line',
      symbolSize: 5,
      emphasis: { focus: 'series' },
      data: data.map((row) => num(row[spec.field])),
      connectNulls: true,
    })),
  }
}

/** Rows actually carried by an option (for chart data caps and previews). */
export function optionDataPoints(option: Record<string, JsonValue>): number {
  const series = option.series
  if (Array.isArray(series)) {
    return series.reduce<number>((sum, s) => sum + (Array.isArray((s as Record<string, JsonValue>).data) ? ((s as Record<string, JsonValue>).data as JsonValue[]).length : 0), 0)
  }
  const data = option.data
  return Array.isArray(data) ? data.length : 0
}

/* ------------------------------------------------------------------ *
 * Automatic chart-type inference                                      *
 * ------------------------------------------------------------------ */

/** Column type signals derived from the actual result rows, not from metadata. */
interface ColumnShape {
  readonly name: string
  /** True when >=80% of non-empty values coerce to a finite number. */
  readonly numeric: boolean
  /** True when values look like dates/times (name hint or ISO-ish values). */
  readonly timeLike: boolean
  readonly distinct: number
}

const TIME_NAME_HINT = /(^|_)(date|time|day|month|year|week|quarter|hour|ts|timestamp|period)(_|$)/i
const TIME_VALUE_RE = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?([ T]|$)/

function classify(data: readonly Record<string, JsonValue>[]): ColumnShape[] {
  const names = data.length > 0 ? Object.keys(data[0]) : []
  return names.map((name) => {
    const values = data.map((row) => row[name]).filter((v) => v !== null && v !== undefined && v !== '')
    const numericCount = values.filter((v) => num(v) !== null).length
    const numeric = values.length > 0 && numericCount / values.length >= 0.8
    const strings = values.map((v) => cellText(v))
    const timeLike = !numeric && values.length > 0 &&
      (TIME_NAME_HINT.test(name) || strings.slice(0, 20).every((v) => TIME_VALUE_RE.test(v)))
    return { name, numeric, timeLike, distinct: new Set(strings).size }
  })
}

export interface AutoChartInput {
  readonly data: readonly Record<string, JsonValue>[]
  readonly xField?: string
  readonly series?: readonly RdSeriesInput[]
  readonly nameField?: string
  readonly valueField?: string
}

/**
 * Pick the most readable chart family for a result shape so the model does not
 * have to guess. Fully deterministic and dependency-free — it inspects only row
 * counts, column cardinality, and whether values are numeric or time-like.
 */
export function autoChartType(input: AutoChartInput): RdChartType {
  const data = input.data
  if (data.length === 0) return 'bar'

  const shapes = classify(data)
  const numeric = shapes.filter((s) => s.numeric)
  const categorical = shapes.filter((s) => !s.numeric)

  // A single row carrying a number reads best as a KPI tile.
  if (data.length === 1 && numeric.length >= 1) return 'kpi'

  // Explicit series/value fields narrow which columns count as "values".
  const requested = input.series?.map((s) => s.field) ??
    (input.valueField !== undefined ? [input.valueField] : undefined)
  const valueShapes = numeric.filter((s) => requested === undefined || requested.includes(s.name))

  const explicitX = input.xField !== undefined ? shapes.find((s) => s.name === input.xField) : undefined
  // Prefer a time-like category, then any category, then the first column.
  const xShape = explicitX ?? categorical.find((s) => s.timeLike) ?? categorical[0] ?? shapes[0]
  if (xShape === undefined) return 'bar'

  // A time-like x axis is almost always a trend.
  if (xShape.timeLike) return 'line'

  // Numeric x against numeric y with enough points is a relationship, not a ranking.
  if (xShape.numeric && valueShapes.some((s) => s.name !== xShape.name) && data.length > 12) return 'scatter'

  const values = valueShapes.filter((s) => s.name !== xShape.name)
  if (values.length === 0) return 'bar'

  // Two categories plus one measure is a matrix.
  if (categorical.some((s) => s.name !== xShape.name) && values.length === 1 && data.length > 4) return 'heatmap'

  // Few unique, non-negative categories describe parts of a whole.
  if (values.length === 1 && data.length >= 2 && data.length <= 8 && xShape.distinct === data.length) {
    const field = values[0].name
    if (data.every((row) => (num(row[field]) ?? -1) >= 0)) return 'pie'
  }

  return 'bar'
}
