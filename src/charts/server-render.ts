/**
 * Server-side chart rendering (host half).
 *
 * Renders a host-built ECharts option to an image without a browser:
 *
 *   1. PNG via the optional `canvas` native module (node-canvas) — when
 *      installed, echarts is pointed at its createCanvas and the chart is
 *      rasterized into a PNG buffer.
 *   2. SVG via echarts' built-in SSR renderer — zero native dependencies,
 *      always available, so export still works when node-canvas is absent.
 *
 * The echarts runtime itself is the UMD text already embedded for offline
 * HTML exports (echarts-umd-text). It is passed in by the caller (the build
 * resolves the virtual module) and evaluated once into a module object —
 * no runtime dependency resolution involved.
 *
 * KPI charts have no real ECharts option; they are rendered as a simple
 * standalone SVG stat card instead.
 *
 * @module dsh-data-analysis/charts/server-render
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/** The subset of the echarts API used here. */
interface EChartsLike {
  init: (el: unknown, theme: unknown, opts: Record<string, unknown>) => {
    setOption: (option: Record<string, unknown>) => void
    renderToSVGString?: () => string
    dispose: () => void
  }
  setPlatformAPI?: (api: { createCanvas: (w: number, h: number) => unknown }) => void
  version?: string
}

let echartsCache: EChartsLike | undefined

/** Evaluate the echarts UMD bundle once into a module object (cached process-wide). */
function loadEcharts(echartsUmd: string | undefined): EChartsLike {
  if (echartsCache !== undefined) return echartsCache
  if (echartsUmd === undefined || echartsUmd === '') {
    throw new Error('data-analysis: server-side rendering needs the echarts UMD text (pass opts.echartsUmd).')
  }
  // The UMD wrapper prefers CommonJS (`typeof exports === 'object'`) — provide
  // a module/exports pair so it populates our object deterministically.
  const factory = new Function(
    'moduleObj',
    'var module = moduleObj;\nvar exports = moduleObj.exports;\n' + echartsUmd + '\n;return moduleObj.exports;',
  )
  const mod = { exports: {} as Record<string, unknown> }
  const ec = factory(mod) as EChartsLike
  if (typeof ec?.init !== 'function') throw new Error('data-analysis: failed to evaluate the embedded echarts UMD bundle.')
  echartsCache = ec
  return ec
}

/** Cheap shape check for the pseudo-option KPI charts carry. */
function isKpi(option: Record<string, JsonValue>): boolean {
  return typeof option.kpi === 'object' && option.kpi !== null
}

/** Standalone SVG stat card for a KPI pseudo-option. */
function kpiSvg(option: Record<string, JsonValue>, width: number, height: number): string {
  const kpi = option.kpi as { value?: JsonValue, unit?: JsonValue, name?: JsonValue }
  const value = Number(kpi.value ?? 0)
  const unit = String(kpi.unit ?? '')
  const name = String(kpi.name ?? '')
  const text = Number.isFinite(value) ? value.toLocaleString('en-US') : String(kpi.value ?? '')
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="${width / 2}" y="${height / 2 - 8}" text-anchor="middle" font-family="-apple-system, Segoe UI, PingFang SC, sans-serif" font-size="64" font-weight="700" fill="#2f6feb">${esc(text)}${unit !== '' ? ` <tspan font-size="28" fill="#6b7280" font-weight="500">${esc(unit)}</tspan>` : ''}</text>
<text x="${width / 2}" y="${height / 2 + 40}" text-anchor="middle" font-family="-apple-system, Segoe UI, PingFang SC, sans-serif" font-size="20" fill="#6b7280">${esc(name)}</text>
</svg>`
}

export interface ServerRenderOptions {
  readonly width?: number
  readonly height?: number
  /** Background color forced onto the image (PNG with transparency looks odd in viewers). */
  readonly background?: string
  /** echarts UMD bundle text (echarts-umd-text); required on the first call, cached after. */
  readonly echartsUmd?: string
}

export type ServerRenderResult =
  | { readonly kind: 'png', readonly buffer: Buffer, readonly width: number, readonly height: number }
  | { readonly kind: 'svg', readonly svg: string, readonly width: number, readonly height: number }

/**
 * Render one ECharts option to an image, server-side. Prefers PNG via the
 * optional node-canvas module; falls back to echarts' SSR SVG renderer
 * (no native deps). KPI pseudo-options render as an SVG stat card.
 */
export async function renderChartImage(option: Record<string, JsonValue>, opts: ServerRenderOptions = {}): Promise<ServerRenderResult> {
  const width = Math.max(120, Math.floor(opts.width ?? 960))
  const height = Math.max(120, Math.floor(opts.height ?? 540))

  if (isKpi(option)) {
    return { kind: 'svg', svg: kpiSvg(option, width, height), width, height }
  }

  const ec = loadEcharts(opts.echartsUmd)
  const prepared: Record<string, unknown> = { ...option, backgroundColor: opts.background ?? '#ffffff' }

  // 1) PNG via node-canvas, when the optional native module is installed.
  try {
    const specifier = 'canvas'
    const canvasMod = (await import(/* @vite-ignore */ specifier)) as { createCanvas?: unknown, default?: { createCanvas?: unknown } }
    const createCanvas = canvasMod.createCanvas ?? canvasMod.default?.createCanvas
    if (typeof createCanvas === 'function') {
      if (typeof ec.setPlatformAPI === 'function') ec.setPlatformAPI({ createCanvas: createCanvas as (w: number, h: number) => unknown })
      const canvas = (createCanvas as (w: number, h: number) => { toBuffer: (fmt: string) => Buffer })(width, height)
      const chart = ec.init(canvas, null, { width, height })
      try {
        chart.setOption(prepared)
        const buffer = canvas.toBuffer('image/png')
        return { kind: 'png', buffer, width, height }
      } finally {
        chart.dispose()
      }
    }
  } catch { /* canvas not installed — fall through to SSR SVG */ }

  // 2) SVG via echarts SSR — always available, no native modules.
  const chart = ec.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    chart.setOption(prepared)
    if (typeof chart.renderToSVGString !== 'function') {
      throw new Error('data-analysis: embedded echarts has no SSR SVG renderer.')
    }
    return { kind: 'svg', svg: chart.renderToSVGString(), width, height }
  } finally {
    chart.dispose()
  }
}
