/**
 * ECharts option builder tests: the host must produce a complete, valid
 * option from chart intent for every supported family.
 */
import { describe, expect, it } from 'vitest'
import { buildEchartsOption, optionDataPoints } from '../src/charts/echarts-option.ts'
import { renderStandaloneHtml, toCsv } from '../src/shared/export-template.ts'

const rows = [
  { dt: '2026-08-01', revenue: 120000, orders: 810 },
  { dt: '2026-08-02', revenue: 95000, orders: 640 },
  { dt: '2026-08-03', revenue: 143000, orders: 902 },
]

describe('buildEchartsOption', () => {
  it('line chart: category x + one series per y field', () => {
    const option = buildEchartsOption({
      chartType: 'line', title: '收入趋势', data: rows,
      xField: 'dt', series: [{ field: 'revenue', name: '收入' }, { field: 'orders' }],
    })
    expect((option.xAxis as { data: string[] }).data).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
    const series = option.series as { name: string, type: string, data: (number | null)[] }[]
    expect(series).toHaveLength(2)
    expect(series[0].data).toEqual([120000, 95000, 143000])
    expect(optionDataPoints(option)).toBe(6)
  })

  it('bar chart defaults y field to the second column', () => {
    const option = buildEchartsOption({ chartType: 'bar', title: 't', data: rows })
    expect((option.series as { type: string }[])[0].type).toBe('bar')
  })

  it('pie chart: name + value slices', () => {
    const share = [
      { city: '杭州', users: 90 }, { city: '上海', users: 78 }, { city: '北京', users: 66 },
    ]
    const option = buildEchartsOption({
      chartType: 'pie', title: '城市分布', data: share, nameField: 'city', valueField: 'users',
    })
    const pie = (option.series as { type: string, data: { name: string, value: number }[] }[])[0]
    expect(pie.type).toBe('pie')
    expect(pie.data[0]).toEqual({ name: '杭州', value: 90 })
  })

  it('scatter: numeric x/y pairs', () => {
    const option = buildEchartsOption({
      chartType: 'scatter', title: '相关性', data: rows, xField: 'orders', series: [{ field: 'revenue' }],
    })
    const points = (option.series as { data: [number, number][] }[])[0].data
    expect(points[0]).toEqual([810, 120000])
  })

  it('heatmap: category grid + visualMap', () => {
    const grid = [
      { day: '周一', hour: '9', v: 3 }, { day: '周一', hour: '10', v: 5 }, { day: '周二', hour: '9', v: 2 },
    ]
    const option = buildEchartsOption({
      chartType: 'heatmap', title: '热力', data: grid, xField: 'day', yField: 'hour', series: [{ field: 'v' }],
    })
    expect(((option.visualMap as { max: number }).max) >= 5).toBe(true)
    expect(optionDataPoints(option)).toBe(3)
  })

  it('kpi: single numeric value with unit', () => {
    const option = buildEchartsOption({
      chartType: 'kpi', title: '总收入', data: [{ total: 1234567.89 }], valueField: 'total', unit: '元',
    })
    expect((option.kpi as { value: number }).value).toBe(1234567.89)
    expect((option.kpi as { unit: string }).unit).toBe('元')
  })

  it('string numbers and nulls are tolerated', () => {
    const option = buildEchartsOption({
      chartType: 'line', title: 't',
      data: [{ m: '1', v: '12' }, { m: '2', v: null }, { m: '3', v: '9.5' }],
      xField: 'm', series: [{ field: 'v' }],
    })
    expect((option.series as { data: (number | null)[] }[])[0].data).toEqual([12, null, 9.5])
  })

  it('throws a friendly error on empty data', () => {
    expect(() => buildEchartsOption({ chartType: 'line', title: 't', data: [] })).toThrow()
  })
})

describe('self-contained HTML export', () => {
  const option = buildEchartsOption({ chartType: 'line', title: '趋势', data: rows, xField: 'dt', series: [{ field: 'revenue' }] })

  it('embeds echarts UMD verbatim and escaped JSON', () => {
    const html = renderStandaloneHtml(
      [{ title: '趋势', datasource: 'demo', sql: 'SELECT 1 -- <script>', echartsOption: option, data: rows, columns: [{ name: 'dt', type: 'text' }] }],
      { title: '测试仪表板', echartsUmd: '/*ECHARTS_UMD*/' },
    )
    expect(html).toContain('/*ECHARTS_UMD*/')
    expect(html).toContain('<!DOCTYPE html>')
    // script-breaking characters must be escaped inside embedded JSON
    expect(html).not.toContain("sql: 'SELECT 1")
    expect(html).toContain('\\u003cscript\\u003e')
  })

  it('mounts chart containers before echarts.init (blank-canvas regression guard)', () => {
    const html = renderStandaloneHtml(
      [{ title: 't', echartsOption: { series: [] }, data: [], columns: [] }],
      { title: 't', echartsUmd: '' },
    )
    const mountAt = html.indexOf("host.appendChild(card)")
    const initAt = html.indexOf('echarts.init(')
    expect(mountAt).toBeGreaterThan(-1)
    expect(initAt).toBeGreaterThan(mountAt)
  })

  it('escapes </script> inside embedded JSON payloads', () => {
    const evil = [{ title: 'x', echartsOption: { a: { s: '</script><script>alert(1)</script>' } }, data: [], columns: [] }]
    const html = renderStandaloneHtml(evil, { title: 'x', echartsUmd: '' })
    expect(html).toContain('\\u003c/script\\u003e')
  })
})

describe('CSV export', () => {
  it('escapes quotes/commas and prepends BOM', () => {
    const csv = toCsv(
      [{ name: 'name' }, { name: 'note' }],
      [{ name: '张,三', note: '说"你好"' }, { name: null, note: '多\n行' }],
    )
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('"张,三"')
    expect(csv).toContain('"说""你好"""')
    expect(csv).toContain('"多\n行"')
  })
})
