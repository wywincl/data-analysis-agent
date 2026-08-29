/**
 * Browser-side exports: self-contained interactive HTML, PNG snapshot, CSV.
 *
 * The HTML artifact embeds the echarts UMD bundle verbatim (built-time text
 * import — no CDN, opens offline) and the chart's option as escaped JSON.
 *
 * @module dsh-rd-data-analysis/client/export-html
 */

import type { RdChartEvent } from '../events.ts'
import type { ClientLocale } from '../i18n/client.ts'
import { renderStandaloneHtml, toCsv } from '../shared/export-template.ts'
import echartsUmd from 'echarts-umd-text'

/** Trigger a client-side file download. */
export function downloadFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.head.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function slug(text: string): string {
  return text.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || 'chart'
}

/** Download the chart as a standalone interactive HTML page (locale drives the exported page's language and date format). */
export function downloadChartHtml(event: RdChartEvent, locale: ClientLocale = 'zh'): void {
  const html = renderStandaloneHtml(
    [{
      title: event.title,
      datasource: event.datasource,
      sql: event.sql,
      createdAt: event.createdAt,
      echartsOption: event.echartsOption,
      data: event.data,
      columns: [...event.columns],
    }],
    { title: event.title, echartsUmd, locale },
  )
  downloadFile(`${slug(event.title)}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }))
}

/** Download the current chart canvas as a 2x PNG (needs the live ECharts instance). */
export function downloadChartPng(event: RdChartEvent, getDataUrl: (() => string) | undefined): void {
  if (getDataUrl === undefined) return
  const base64 = getDataUrl()
  const binary = atob(base64.split(',')[1] ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  downloadFile(`${slug(event.title)}.png`, new Blob([bytes], { type: 'image/png' }))
}

/** Download the chart data as CSV (BOM included for Excel). */
export function downloadChartCsv(event: RdChartEvent): void {
  downloadFile(`${slug(event.title)}.csv`, new Blob([toCsv([...event.columns], [...event.data])], { type: 'text/csv;charset=utf-8' }))
}

/** Clipboard helper with a textarea fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
