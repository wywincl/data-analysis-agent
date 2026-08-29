/**
 * Self-contained HTML export template, shared by the browser half (per-chart
 * download) and the host half (`/export` dashboard).
 *
 * The artifact embeds the echarts UMD bundle verbatim (no CDN, opens
 * offline), the chart options as JSON, and a small init script. KPI charts
 * render as stat cards instead of a canvas.
 *
 * @module dsh-research/shared/export-template
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import { en, zh, type HostLocale } from '../i18n/host.ts'
import { tpl } from '../i18n/index.ts'

export interface ExportedChart {
  readonly title: string
  readonly datasource?: string
  readonly sql?: string
  readonly createdAt?: string
  readonly echartsOption: Record<string, JsonValue>
  readonly data: readonly Record<string, JsonValue>[]
  readonly columns: readonly { readonly name: string, readonly type: string }[]
}

/** JSON.stringify with `<`/`&` escapes so embedded JSON cannot break out of <script>. */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Build the standalone, offline-openable HTML for one or more charts. */
export function renderStandaloneHtml(charts: readonly ExportedChart[], meta: { readonly title: string, readonly echartsUmd: string, readonly locale?: HostLocale }): string {
  const locale: HostLocale = meta.locale === 'en' ? 'en' : 'zh'
  const s = locale === 'en' ? en : zh
  const dateLocale = locale === 'en' ? 'en-US' : 'zh-CN'
  const payload = charts.map((chart) => ({
    title: chart.title,
    datasource: chart.datasource ?? '',
    sql: chart.sql ?? '',
    createdAt: chart.createdAt ?? '',
    option: chart.echartsOption,
  }))
  return `<!DOCTYPE html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>
  :root { color-scheme: light; --border: #e5e7eb; --muted: #6b7280; --accent: #2f6feb; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #111827; }
  header { padding: 20px 28px 8px; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
  main { padding: 16px 28px 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px 10px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  .card h2 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  .chart { width: 100%; height: 320px; }
  .kpi { font-size: 40px; font-weight: 700; color: var(--accent); padding: 84px 0; text-align: center; }
  .kpi small { font-size: 16px; color: var(--muted); font-weight: 500; margin-left: 4px; }
  details { font-size: 12px; color: var(--muted); margin-top: 4px; }
  pre { background: #f3f4f6; border-radius: 6px; padding: 8px; overflow: auto; white-space: pre-wrap; }
  footer { padding: 0 28px 28px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(meta.title)}</h1>
  <p>${escapeHtml(tpl(s['export.html.byline'], { time: new Date().toLocaleString(dateLocale), count: charts.length }))}</p>
</header>
<main id="charts"></main>
<footer>${escapeHtml(s['export.html.footer'])}</footer>
<script>${meta.echartsUmd}</script>
<script>
var RD_LOCALE = ${JSON.stringify(dateLocale)};
var RD_CHARTS = ${embedJson(payload)};
(function () {
  var host = document.getElementById('charts');
  RD_CHARTS.forEach(function (chart, index) {
    var card = document.createElement('div');
    card.className = 'card';
    var meta = chart.datasource ? ' · ' + chart.datasource : '';
    card.innerHTML = '<h2>' + (index + 1) + '. ' + chart.title + '</h2>' +
      '<div class="meta">' + chart.createdAt + meta + '</div>';
    var body = document.createElement('div');
    card.appendChild(body);
    // Mount BEFORE echarts.init: a detached container reports a 0x0 size and
    // the canvas would initialize blank.
    host.appendChild(card);
    if (chart.option && chart.option.kpi) {
      var stat = document.createElement('div');
      stat.className = 'kpi';
      stat.innerHTML = Number(chart.option.kpi.value).toLocaleString(RD_LOCALE) +
        (chart.option.kpi.unit ? '<small>' + chart.option.kpi.unit + '</small>' : '');
      body.appendChild(stat);
    } else {
      var el = document.createElement('div');
      el.className = 'chart';
      body.appendChild(el);
      var instance = echarts.init(el, null, { renderer: 'svg' });
      instance.setOption(chart.option);
      window.addEventListener('resize', function () { instance.resize(); });
    }
    if (chart.sql) {
      var details = document.createElement('details');
      details.innerHTML = '<summary>SQL</summary><pre></pre>';
      details.querySelector('pre').textContent = chart.sql;
      card.appendChild(details);
    }
  });
})();
</script>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** RFC-4180 CSV with BOM so Excel opens Chinese text correctly. */
export function toCsv(columns: readonly { readonly name: string }[], rows: readonly Record<string, unknown>[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = columns.map((col) => escape(col.name)).join(',')
  const body = rows.map((row) => columns.map((col) => escape(row[col.name])).join(',')).join('\n')
  return `\uFEFF${header}\n${body}`
}
