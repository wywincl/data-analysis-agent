import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderChartImage } from '../src/charts/server-render.ts'

// The real UMD bundle — exactly what the build injects as echarts-umd-text.
const echartsUmd = readFileSync('node_modules/echarts/dist/echarts.min.js', 'utf8')

const barOption = {
  backgroundColor: 'transparent',
  title: { text: 'GMV' },
  xAxis: { type: 'category', data: ['杭州', '上海'] },
  yAxis: { type: 'value' },
  series: [{ name: 'amount', type: 'bar', data: [100, 200] }],
} as unknown as Record<string, never>

describe('renderChartImage (server-side)', () => {
  it('renders a chart to SVG via the echarts SSR renderer', async () => {
    const image = await renderChartImage(barOption, { width: 400, height: 300, echartsUmd })
    // node-canvas is not installed in this repo, so the SSR SVG path is used.
    expect(image.kind).toBe('svg')
    if (image.kind !== 'svg') return
    expect(image.svg.startsWith('<svg')).toBe(true)
    expect(image.svg).toContain('杭州')
    expect(image.width).toBe(400)
    expect(image.height).toBe(300)
  })

  it('renders a KPI pseudo-option as an SVG stat card (no echarts needed)', async () => {
    const image = await renderChartImage({ kpi: { value: 123456, unit: '元', name: '总营收' } }, { width: 400, height: 200, echartsUmd })
    expect(image.kind).toBe('svg')
    if (image.kind !== 'svg') return
    expect(image.svg.startsWith('<svg')).toBe(true)
    expect(image.svg).toContain('123,456')
    expect(image.svg).toContain('总营收')
  })

  it('forces a white background so viewers do not show transparency as black', async () => {
    const image = await renderChartImage(barOption, { width: 320, height: 200, echartsUmd })
    if (image.kind !== 'svg') return
    expect(image.svg).toMatch(/fill="#ffffff"/)
  })

  it('never returns a zero-size image regardless of the requested size', async () => {
    const image = await renderChartImage(barOption, { width: 1, height: -5, echartsUmd })
    expect(image.width).toBeGreaterThanOrEqual(120)
    expect(image.height).toBeGreaterThanOrEqual(120)
  })
})
