/**
 * End-to-end smoke test for the exported interactive dashboard.
 *
 * The artifact is a single self-contained HTML file (echarts UMD inlined, no
 * network). This suite opens it in a real browser and exercises what the
 * jsdom-free unit tests cannot reach:
 *   - echarts actually mounts and paints with the SVG renderer
 *   - clicking a bar / pie slice cross-filters the other cards
 *   - the filter state is written to the URL hash and restored on load
 *
 * These assertions are the regression net for the dashboard's *runtime* — the
 * static-HTML tests only check the emitted markup, which is how a missing
 * `yAxis` in the client-side rebuild once shipped every card blank.
 *
 * Playwright is an OPTIONAL dependency. When the package or its browser
 * binaries are missing the whole suite skips instead of failing — CI installs
 * it, a plain `npm ci` on a dev box does not have to.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  encodeFilterState,
  renderStandaloneHtml,
  type ExportedChart,
} from '../src/shared/export-template.ts'

// ── optional dependency wiring ────────────────────────────────────────────
interface LocatorLike {
  count(): Promise<number>
  first(): LocatorLike
  waitFor(options?: { state?: string, timeout?: number }): Promise<unknown>
  click(options?: { timeout?: number }): Promise<void>
  textContent(): Promise<string | null>
}
interface PageLike {
  goto(url: string): Promise<unknown>
  setViewportSize(size: { width: number, height: number }): Promise<unknown>
  mouse: { click(x: number, y: number): Promise<void> }
  locator(selector: string): LocatorLike
  evaluate<R>(fn: () => R): Promise<R>
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>
}
interface BrowserLike { newPage(): Promise<PageLike>, close(): Promise<void> }
interface ChromiumLike { launch(): Promise<BrowserLike> }

const specifier = 'playwright'
let chromium: ChromiumLike | undefined
try {
  const mod: unknown = await import(/* @vite-ignore */ specifier)
  chromium = (mod as { chromium?: unknown }).chromium as ChromiumLike | undefined
} catch {
  chromium = undefined
}

// Launch at module scope: `beforeAll` cannot skip the whole suite, so the
// availability decision has to be made before `describe` runs.
let browser: BrowserLike | undefined
let launchNote: string | undefined
if (chromium !== undefined) {
  try {
    browser = await chromium.launch()
  } catch (error) {
    // Package present but browser binaries missing → `npx playwright install`.
    launchNote = (error as Error).message.split('\n')[0]
  }
}
const describeE2e = browser !== undefined ? describe : describe.skip
if (browser === undefined) {
  // Surface the reason next to the "skipped" line instead of silently passing.
  console.warn(`[e2e-dashboard] skipped: ${chromium === undefined ? 'playwright not installed' : (launchNote ?? 'browser launch failed')}`)
}

// ── fixture: two cards that share the `city` dimension ────────────────────
const echartsUmd = readFileSync('node_modules/echarts/dist/echarts.min.js', 'utf8')

const rows = [
  { city: '杭州', revenue: 120, orders: 12 },
  { city: '上海', revenue: 300, orders: 30 },
  { city: '北京', revenue: 210, orders: 21 },
]

const charts: ExportedChart[] = [
  {
    title: '各城市营收',
    datasource: 'demo',
    sql: 'SELECT city, SUM(amount) AS revenue FROM orders GROUP BY city',
    createdAt: '2026-08-30 10:00',
    echartsOption: {
      backgroundColor: 'transparent',
      title: { text: '各城市营收', left: 'left' },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 0 },
      grid: { left: 48, right: 24, top: 40, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => r.city) },
      yAxis: { type: 'value' },
      series: [{ name: 'revenue', type: 'bar', data: rows.map((r) => r.revenue) }],
    } as unknown as Record<string, never>,
    data: rows,
    columns: [{ name: 'city', type: 'text' }, { name: 'revenue', type: 'number' }, { name: 'orders', type: 'number' }],
    fields: { chartType: 'bar', xField: 'city', yFields: ['revenue'] },
  },
  {
    title: '营收占比',
    datasource: 'demo',
    echartsOption: {
      backgroundColor: 'transparent',
      title: { text: '营收占比', left: 'left' },
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['42%', '56%'],
        data: rows.map((r) => ({ name: r.city, value: r.revenue })),
      }],
    } as unknown as Record<string, never>,
    data: rows,
    columns: [{ name: 'city', type: 'text' }, { name: 'revenue', type: 'number' }, { name: 'orders', type: 'number' }],
    fields: { chartType: 'pie', nameField: 'city', valueField: 'revenue' },
  },
]

const html = renderStandaloneHtml(charts, { title: 'E2E 冒烟看板', echartsUmd, locale: 'zh' })

// Each test gets its OWN file: navigating between two file:// URLs that differ
// only by hash is a same-document navigation, so the page would not reload and
// filter state would leak between tests.
const workdir = mkdtempSync(join(tmpdir(), 'rd-e2e-'))
function writeDashboard(name: string): string {
  const file = join(workdir, `${name}.html`)
  writeFileSync(file, html, 'utf8')
  return 'file://' + file
}

// Loading a ~1 MB inlined UMD bundle + painting two charts is far slower than
// vitest's default 5 s test budget.
const E2E_TIMEOUT = 60_000

// The accent the bar series is painted with (RD_PALETTE[0] in the template).
const BAR_FILL = '#2f6feb'

let page: PageLike | undefined

describeE2e('exported dashboard (browser E2E)', () => {
  beforeAll(async () => {
    if (browser === undefined) return
    page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  afterAll(async () => {
    await browser?.close()
    rmSync(workdir, { recursive: true, force: true })
  })

  it('opens offline and paints every card with the SVG renderer', async () => {
    if (page === undefined) return
    await page.goto(writeDashboard('paint'))
    const cards = page.locator('.card')
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
    expect(await cards.count()).toBe(2)
    // echarts mounted with renderer:'svg' → a real, non-empty <svg> per card
    const svgs = page.locator('.chart svg')
    await svgs.first().waitFor({ state: 'visible', timeout: 15_000 })
    expect(await svgs.count()).toBe(2)
    await vi.waitFor(async () => {
      const shapes = await page!.evaluate(() => document.querySelectorAll('.chart svg path').length)
      expect(shapes).toBeGreaterThan(4)
    }, { timeout: 10_000, interval: 200 })
    // All three categories painted (catches a blank/throw-on-paint regression).
    const text = await page.evaluate(() => document.body.innerText)
    for (const city of ['杭州', '上海', '北京']) expect(text).toContain(city)
  }, E2E_TIMEOUT)

  it('clicking a category cross-filters the other card and writes the URL hash', async () => {
    if (page === undefined) return
    await page.goto(writeDashboard('click'))
    await page.locator('.chart svg').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Bars animate up from the axis on first paint. Sampling too early picks
    // the legend marker (a static 14×14 shape in the same series color)
    // instead of a bar, and clicking that only toggles the legend.
    const barProbe = (fill: string) => {
      const host = document.querySelector('.card:first-child .chart')
      if (host === null) return 0
      let tallest = 0
      for (const path of Array.from(host.querySelectorAll('path'))) {
        if ((path.getAttribute('fill') ?? '').toLowerCase() !== fill) continue
        const rect = path.getBoundingClientRect()
        if (rect.width < 20) continue
        tallest = Math.max(tallest, rect.height)
      }
      return tallest
    }
    await vi.waitFor(async () => {
      const height = await page!.evaluate(barProbe, BAR_FILL)
      expect(height).toBeGreaterThan(80)
    }, { timeout: 10_000, interval: 200 })

    // Click the middle of the largest painted bar. Coordinates are resolved in
    // one pass: re-rendering invalidates any locator collected beforehand.
    const point = await page.evaluate((fill: string) => {
      const host = document.querySelector('.card:first-child .chart')
      if (host === null) return null
      let best: { x: number, y: number } | null = null
      let bestArea = 0
      for (const path of Array.from(host.querySelectorAll('path'))) {
        if ((path.getAttribute('fill') ?? '').toLowerCase() !== fill) continue
        const rect = path.getBoundingClientRect()
        if (rect.width < 4 || rect.height < 4) continue
        const area = rect.width * rect.height
        if (area <= bestArea) continue
        bestArea = area
        best = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
      return best
    }, BAR_FILL)
    expect(point, `no ${BAR_FILL} bar found in the first card`).not.toBeNull()
    await page.mouse.click(point!.x, point!.y)

    // Hash written, chip rendered, both cards marked as filtered.
    await vi.waitFor(async () => {
      const hash = await page!.evaluate(() => location.hash)
      expect(hash).toContain('f=')
    }, { timeout: 10_000, interval: 100 })
    const hash = await page.evaluate(() => decodeURIComponent(location.hash))
    expect(hash).toMatch(/#f=\{"city":"(杭州|上海|北京)"\}/)
    await vi.waitFor(async () => {
      const chips = await page!.locator('#filterbar .chip').count()
      expect(chips).toBeGreaterThan(0)
    }, { timeout: 10_000, interval: 100 })
    await vi.waitFor(async () => {
      const filtered = await page!.locator('.card.is-filtered').count()
      expect(filtered).toBe(2)
    }, { timeout: 10_000, interval: 100 })
    // "已筛选: 3 行 → 1 行" — the note reports the reduced row count.
    const note = await page.locator('.card.is-filtered .filtered').first().textContent()
    expect(note).toContain('3')
    expect(note).toContain('1')
  }, E2E_TIMEOUT)

  it('restores a shared filter state from the URL hash', async () => {
    if (page === undefined) return
    await page.goto(writeDashboard('shared') + '#' + encodeFilterState({ city: '上海' }))
    await page.locator('.card').first().waitFor({ state: 'visible', timeout: 15_000 })
    await vi.waitFor(async () => {
      const chips = await page!.locator('#filterbar .chip').count()
      // one filter chip + the "clear all" chip
      expect(chips).toBe(2)
    }, { timeout: 10_000, interval: 100 })
    const chipText = await page.locator('#filterbar .chip').first().textContent()
    expect(chipText).toContain('city')
    expect(chipText).toContain('上海')
    await vi.waitFor(async () => {
      const filtered = await page!.locator('.card.is-filtered').count()
      expect(filtered).toBe(2)
    }, { timeout: 10_000, interval: 100 })
  }, E2E_TIMEOUT)

  it('clears every filter when the chip is dismissed', async () => {
    if (page === undefined) return
    await page.goto(writeDashboard('clear') + '#' + encodeFilterState({ city: '北京' }))
    await page.locator('#filterbar .chip').first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('#filterbar .chip').first().click({ timeout: 5_000 })
    await vi.waitFor(async () => {
      const hash = await page!.evaluate(() => location.hash)
      expect(hash).toBe('')
    }, { timeout: 10_000, interval: 100 })
    expect(await page.locator('.card.is-filtered').count()).toBe(0)
  }, E2E_TIMEOUT)
})
