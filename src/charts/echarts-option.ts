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
