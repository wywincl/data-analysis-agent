/**
 * Self-contained HTML export template, shared by the browser half (per-chart
 * download) and the host half (`/export` dashboard).
 *
 * The artifact embeds the echarts UMD bundle verbatim (no CDN, opens
 * offline), the chart options as JSON, plus each chart's data rows and field
 * metadata. KPI charts render as stat cards instead of a canvas.
 *
 * The exported dashboard is INTERACTIVE: clicking a category (bar / line
 * x-axis value, pie slice) cross-filters every other chart that carries the
 * same field; the filter state lives in the URL hash (`#f=...`), so copying
 * the file URL (path + hash) restores — shares — the exact view.
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
  /** Field metadata enabling client-side cross-filtering (line/bar/pie/scatter). */
  readonly fields?: {
    readonly chartType: string
    readonly xField?: string
    readonly yFields?: readonly string[]
    readonly nameField?: string
    readonly valueField?: string
  }
}

/** Dashboard filter state: dimension field → selected value (single-select, AND-combined). */
export type DashboardFilterState = Record<string, string>

/** URL-hash encoding of a filter state (`f=` query fragment, no leading '#'). */
export function encodeFilterState(filters: DashboardFilterState): string {
  return `f=${encodeURIComponent(JSON.stringify(filters))}`
}

/** Parse a location.hash (or bare fragment) back into a filter state; {} when absent/invalid. */
export function decodeFilterState(hash: string): DashboardFilterState {
  const fragment = hash.replace(/^#/, '')
  const match = /^f=(.*)$/.exec(fragment)
  if (match === null) return {}
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1] ?? ''))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const filters: DashboardFilterState = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value !== '') filters[key] = value
    }
    return filters
  } catch {
    return {}
  }
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
    data: chart.data,
    fields: chart.fields ?? null,
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
  #filterbar { padding: 4px 28px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  #filterbar .hint { color: var(--muted); font-size: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; background: #eef4ff; border: 1px solid #c7d9fb; color: #1d4ed8; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
  .chip:hover { background: #dbe8fe; }
  .chip .x { font-weight: 700; }
  .chip.clear { background: #fff; border-color: var(--border); color: var(--muted); }
  main { padding: 16px 28px 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px 10px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  .card h2 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  .filtered { display: none; color: #1d4ed8; font-size: 12px; margin-bottom: 2px; }
  .card.is-filtered .filtered { display: block; }
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
<div id="filterbar"></div>
<main id="charts"></main>
<footer>${escapeHtml(s['export.html.footer'])}</footer>
<script>${meta.echartsUmd}</script>
<script>
var RD_LOCALE = ${JSON.stringify(dateLocale)};
var RD_FILTER_HINT = ${JSON.stringify(s['export.html.filterHint'])};
var RD_CLEAR = ${JSON.stringify(s['export.html.clearFilters'])};
var RD_FILTERED = ${JSON.stringify(s['export.html.filteredNote'])};
var RD_PALETTE = ['#2f6feb','#12b76a','#f79009','#7a5af8','#ee46bc','#06aed4','#e5484d','#8f8f8f'];
var RD_CHARTS = ${embedJson(payload)};
(function () {
  var filters = {};
  var instances = [];

  // ── filter state ↔ URL hash ─────────────────────────────────────────────
  function readHash() {
    var m = /^#f=(.*)$/.exec(location.hash || '');
    if (!m) return;
    try {
      var parsed = JSON.parse(decodeURIComponent(m[1]));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(function (k) {
          if (typeof parsed[k] === 'string' && parsed[k] !== '') filters[k] = parsed[k];
        });
      }
    } catch (e) { /* corrupt hash — ignore */ }
  }
  function writeHash() {
    var keys = Object.keys(filters);
    if (keys.length === 0) { history.replaceState(null, '', location.pathname + location.search); return; }
    history.replaceState(null, '', location.pathname + location.search + '#f=' + encodeURIComponent(JSON.stringify(filters)));
  }

  // ── minimal client-side rebuild for filtered rows ───────────────────────
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') { var n = Number(v); return isFinite(n) ? n : null; }
    return null;
  }
  function txt(v) { return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
  function base(title) {
    return { backgroundColor: 'transparent', title: { text: title, left: 'left', textStyle: { fontSize: 14, fontWeight: 600 } },
      tooltip: { trigger: 'axis' }, legend: { type: 'scroll', top: 0, right: 0 },
      grid: { left: 48, right: 24, top: 40, bottom: 40 }, color: RD_PALETTE };
  }
  function rebuildOption(chart, rows) {
    var f = chart.fields;
    if (!f) return chart.option;
    if (f.chartType === 'line' || f.chartType === 'bar') {
      var xf = f.xField, ys = f.yFields || [];
      if (!xf || ys.length === 0 || rows.length === 0) return chart.option;
      var o = base(chart.title);
      o.xAxis = { type: 'category', data: rows.map(function (r) { return txt(r[xf]); }), boundaryGap: f.chartType === 'bar' };
      o.series = ys.map(function (y) { return { name: y, type: f.chartType, data: rows.map(function (r) { return num(r[y]); }) }; });
      return o;
    }
    if (f.chartType === 'pie') {
      var nf = f.nameField, vf = f.valueField;
      if (!nf || !vf || rows.length === 0) return chart.option;
      var o2 = base(chart.title);
      o2.tooltip = { trigger: 'item' };
      o2.legend = { type: 'scroll', orient: 'vertical', right: 8, top: 'middle' };
      o2.series = [{ type: 'pie', radius: ['38%', '68%'], center: ['42%', '56%'], avoidLabelOverlap: true,
        data: rows.map(function (r) { return { name: txt(r[nf]), value: num(r[vf]) === null ? 0 : num(r[vf]) }; }),
        label: { formatter: '{b}: {d}%' } }];
      return o2;
    }
    if (f.chartType === 'scatter') {
      var sx = f.xField, sy = (f.yFields || [])[0];
      if (!sx || !sy || rows.length === 0) return chart.option;
      var o3 = base(chart.title);
      o3.tooltip = { trigger: 'item' };
      o3.xAxis = { type: 'value', scale: true, name: sx };
      o3.yAxis = { type: 'value', scale: true };
      o3.series = [{ name: sy, type: 'scatter', symbolSize: 7,
        data: rows.map(function (r) { return [num(r[sx]) === null ? 0 : num(r[sx]), num(r[sy]) === null ? 0 : num(r[sy])]; }) }];
      return o3;
    }
    return chart.option;
  }

  function filterRows(chart) {
    var rows = chart.data || [];
    var keys = Object.keys(filters);
    if (keys.length === 0 || rows.length === 0) return rows;
    var fields = Object.keys(rows[0]);
    var applies = keys.every(function (k) { return fields.indexOf(k) >= 0; });
    if (!applies) return rows;
    return rows.filter(function (r) {
      return keys.every(function (k) { return txt(r[k]) === filters[k]; });
    });
  }

  function clickField(chart) {
    var f = chart.fields;
    if (!f) return null;
    if (f.chartType === 'pie') return f.nameField || null;
    if (f.chartType === 'line' || f.chartType === 'bar') return f.xField || null;
    return null;
  }

  // ── rendering ───────────────────────────────────────────────────────────
  var host = document.getElementById('charts');
  RD_CHARTS.forEach(function (chart, index) {
    var card = document.createElement('div');
    card.className = 'card';
    var meta = chart.datasource ? ' · ' + chart.datasource : '';
    card.innerHTML = '<h2>' + (index + 1) + '. ' + chart.title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</h2>' +
      '<div class="meta">' + chart.createdAt + meta + '</div>' +
      '<div class="filtered"></div>';
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
      instances.push({ chart: chart, card: card, instance: instance, el: el });
      instance.setOption(currentOption(chart));
      window.addEventListener('resize', function () { instance.resize(); });
      var field = clickField(chart);
      if (field !== null) {
        el.style.cursor = 'pointer';
        instance.on('click', function (params) {
          if (typeof params.name !== 'string' || params.name === '') return;
          if (filters[field] === params.name) delete filters[field];
          else filters[field] = params.name;
          refresh();
        });
      }
    }
    if (chart.sql) {
      var details = document.createElement('details');
      details.innerHTML = '<summary>SQL</summary><pre></pre>';
      details.querySelector('pre').textContent = chart.sql;
      card.appendChild(details);
    }
  });

  function currentOption(chart) {
    var rows = filterRows(chart);
    return rebuildOption(chart, rows);
  }

  function refresh() {
    instances.forEach(function (entry) {
      entry.instance.setOption(currentOption(entry.chart), { notMerge: true });
      var rows = filterRows(entry.chart);
      var total = (entry.chart.data || []).length;
      var applies = Object.keys(filters).length > 0 && total > 0 &&
        Object.keys(filters).every(function (k) { return Object.keys(entry.chart.data[0]).indexOf(k) >= 0; });
      entry.card.classList.toggle('is-filtered', applies);
      if (applies) {
        entry.card.querySelector('.filtered').textContent =
          RD_FILTERED.replace('{from}', String(total)).replace('{to}', String(rows.length));
      }
    });
    renderFilterBar();
    writeHash();
  }

  function renderFilterBar() {
    var bar = document.getElementById('filterbar');
    bar.textContent = '';
    var keys = Object.keys(filters);
    if (keys.length === 0) {
      var hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = RD_FILTER_HINT;
      bar.appendChild(hint);
      return;
    }
    keys.forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      var label = document.createElement('span');
      label.textContent = k + ' = ' + filters[k];
      var x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      chip.appendChild(label);
      chip.appendChild(x);
      chip.addEventListener('click', function () { delete filters[k]; refresh(); });
      bar.appendChild(chip);
    });
    var clear = document.createElement('span');
    clear.className = 'chip clear';
    clear.textContent = RD_CLEAR;
    clear.addEventListener('click', function () { filters = {}; refresh(); });
    bar.appendChild(clear);
  }

  readHash();
  refresh();
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
