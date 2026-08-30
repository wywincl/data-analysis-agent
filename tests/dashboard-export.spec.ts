import { describe, expect, it } from 'vitest'
import { decodeFilterState, encodeFilterState, renderStandaloneHtml } from '../src/shared/export-template.ts'
import type { ExportedChart } from '../src/shared/export-template.ts'

const chart: ExportedChart = {
  title: '城市 GMV',
  datasource: 'demo',
  sql: 'SELECT city, SUM(amount) AS amount FROM orders GROUP BY city',
  createdAt: '2026-08-30T00:00:00.000Z',
  echartsOption: {
    xAxis: { type: 'category', data: ['杭州', '上海'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [1, 2] }],
  } as unknown as ExportedChart['echartsOption'],
  data: [{ city: '杭州', amount: 1 }, { city: '上海', amount: 2 }],
  columns: [{ name: 'city', type: 'text' }, { name: 'amount', type: 'real' }],
  fields: { chartType: 'bar', xField: 'city', yFields: ['amount'] },
}

describe('filter-state URL hash codec', () => {
  it('round-trips a non-empty filter state', () => {
    const encoded = encodeFilterState({ city: '杭州', status: 'paid' })
    expect(encoded.startsWith('f=')).toBe(true)
    expect(decodeFilterState(`#${encoded}`)).toEqual({ city: '杭州', status: 'paid' })
  })

  it('round-trips the empty state', () => {
    expect(decodeFilterState(`#${encodeFilterState({})}`)).toEqual({})
  })

  it('returns {} for absent, corrupt, or non-object hashes', () => {
    expect(decodeFilterState('')).toEqual({})
    expect(decodeFilterState('#other=1')).toEqual({})
    expect(decodeFilterState('#f=%E0%A4%A')).toEqual({})
    expect(decodeFilterState('#f=' + encodeURIComponent('["array"]'))).toEqual({})
    expect(decodeFilterState('#f=' + encodeURIComponent('null'))).toEqual({})
  })

  it('drops non-string / empty values from the parsed state', () => {
    const raw = '#f=' + encodeURIComponent(JSON.stringify({ ok: 'yes', bad: 3, empty: '', also: null }))
    expect(decodeFilterState(raw)).toEqual({ ok: 'yes' })
  })
})

describe('renderStandaloneHtml (interactive dashboard)', () => {
  const html = renderStandaloneHtml([chart], { title: 'board', echartsUmd: '/* echarts umd stub */' })

  it('embeds data rows and field metadata for client-side filtering', () => {
    expect(html).toContain('RD_CHARTS')
    expect(html).toContain('"xField":"city"')
    expect(html).toContain('"yFields":["amount"]')
  })

  it('contains the cross-filter machinery and URL-hash persistence', () => {
    expect(html).toContain('function rebuildOption')
    expect(html).toContain('writeHash')
    expect(html).toContain('readHash')
    expect(html).toContain('instance.on(\'click\'')
    expect(html).toContain('renderFilterBar')
    expect(html).toContain('encodeURIComponent(JSON.stringify(filters))')
  })

  it('escapes chart titles so raw markup never reaches the static HTML', () => {
    const evil: ExportedChart = { ...chart, title: '<img src=x onerror=alert(1)>' }
    const out = renderStandaloneHtml([evil], { title: 't', echartsUmd: '' })
    // The embedded JSON escapes `<` (browser runtime escapes & too); the raw
    // tag must not appear anywhere in the static markup.
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('\\u003cimg src=x')
  })

  it('rebuilds cartesian charts with a yAxis (missing it paints a blank card)', () => {
    // Regression: the bar/line branch of rebuildOption() used to emit only an
    // xAxis. echarts then threw while building the cartesian coordinate system
    // and every filtered card — in fact every card, since rebuildOption runs on
    // first paint — rendered empty. Caught by tests/e2e-dashboard.spec.ts; this
    // static guard keeps it caught on machines without a browser.
    expect(html).toContain('o.yAxis = (isPlain(src.yAxis) || Array.isArray(src.yAxis)) ? clone(src.yAxis) : { type: \'value\' }')
    // Scatter declares both axes explicitly; pie needs none.
    expect(html).toContain('o3.yAxis = { type: \'value\', scale: true }')
  })

  it('renders without fields metadata (older payloads stay exportable)', () => {
    const legacy: ExportedChart = { ...chart, fields: undefined }
    const out = renderStandaloneHtml([legacy], { title: 't', echartsUmd: 'stub' })
    expect(out).toContain('RD_CHARTS')
    expect(out).toContain('"fields":null')
  })
})
