/**
 * Chat chart node: renders the durable `rd/chart` payload as a live ECharts
 * canvas (SVG renderer, theme-agnostic) with export and SQL provenance
 * affordances. Reads only `node.data` — replay-safe per the cookbook.
 *
 * @module dsh-rd-data-analysis/client/ChartNodeView
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as echarts from 'echarts'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RdChartEvent } from '../events.ts'
import { copyText, downloadChartCsv, downloadChartHtml, downloadChartPng } from './export-html.ts'
import { en, zh, type ClientKey, type ClientLocale } from '../i18n/client.ts'
import { HOST_TOKENS, rdVars } from './theme.ts'

/**
 * Infer the active locale from `t`'s output: the framework binds `t` to the
 * host locale service (falling back to our config locale), and zh/en differ
 * for every key, so one probe translation is enough to tell them apart.
 */
function localeOf(t: (key: ClientKey) => string): ClientLocale {
  const probe = t('chart.exportHtml')
  if (probe === en['chart.exportHtml']) return 'en'
  if (probe === zh['chart.exportHtml']) return 'zh'
  return 'zh'
}

/** Live ECharts instance handle for PNG export. */
export interface ChartHandle {
  readonly getDataUrl: () => string
}

function KpiView({ event, t }: { event: RdChartEvent; t: (key: ClientKey) => string }): ReactNode {
  const kpi = event.echartsOption.kpi as { value?: number, unit?: string, name?: string } | undefined
  const value = typeof kpi?.value === 'number' ? kpi.value : null
  return (
    <div style={kpiStyle}>
      <div style={kpiName}>{event.title}</div>
      <div style={kpiValue}>
        {value === null ? '—' : value.toLocaleString(localeOf(t) === 'en' ? 'en-US' : 'zh-CN')}
        {kpi?.unit ? <span style={kpiUnit}> {kpi.unit}</span> : null}
      </div>
    </div>
  )
}

/** Main node view: chart canvas + toolbar + SQL provenance. */
export function RdChartNodeView({ node, t }: ChatNodeViewProps<'rd-chart'> & { t: (key: ClientKey) => string }): ReactNode {
  const event: RdChartEvent = node.data
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const [copied, setCopied] = useState(false)
  const isKpi = event.chartType === 'kpi'

  useEffect(() => {
    if (isKpi) return
    const element = containerRef.current
    if (element === null) return
    const instance = echarts.init(element, undefined, { renderer: 'svg' })
    instance.setOption(event.echartsOption)
    chartRef.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      instance.dispose()
      chartRef.current = null
    }
  }, [isKpi, event.echartsOption])

  const handle = (): ChartHandle | undefined => {
    const instance = chartRef.current
    if (instance === null) return undefined
    return { getDataUrl: () => instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }) }
  }

  return (
    <div style={root}>
      <div style={headerRow}>
        <span style={datasourceChip}>{event.datasource}</span>
        <span style={timestamp}>{event.createdAt.replace('T', ' ').slice(0, 19)}</span>
      </div>

      {isKpi ? <KpiView event={event} t={t} /> : <div ref={containerRef} style={chartBox} />}

      <div style={toolbar}>
        <button type="button" style={button} onClick={() => downloadChartHtml(event, localeOf(t))}>{t('chart.exportHtml')}</button>
        {!isKpi && (
          <button type="button" style={button} onClick={() => downloadChartPng(event, handle()?.getDataUrl)}>{t('chart.png')}</button>
        )}
        <button type="button" style={button} onClick={() => downloadChartCsv(event)}>{t('chart.csv')}</button>
        {event.sql !== undefined && (
          <button
            type="button"
            style={button}
            onClick={() => {
              void copyText(event.sql ?? '').then((ok) => {
                setCopied(ok)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? t('chart.copied') : t('chart.copySql')}
          </button>
        )}
      </div>

      {event.sql !== undefined && (
        <details style={details}>
          <summary style={summary}>{t('chart.sql')}</summary>
          <pre style={sqlBox}>{event.sql}</pre>
        </details>
      )}
    </div>
  )
}

// Chart nodes have no per-plugin theme override of their own: always follow
// the host appearance via the `--dsw-alias-*` tokens (see theme.ts).
const chartVars = rdVars(HOST_TOKENS)

const root: React.CSSProperties = {
  ...chartVars,
  display: 'flex', flexDirection: 'column', gap: 8,
  border: '1px solid var(--rd-border)', borderRadius: 12,
  padding: '10px 14px', margin: '4px 0', background: 'transparent',
  color: 'var(--rd-text)', maxWidth: 720,
}
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const datasourceChip: React.CSSProperties = {
  fontSize: 11, color: 'var(--rd-accent)',
  border: '1px solid var(--rd-border)', borderRadius: 999, padding: '1px 8px',
}
const timestamp: React.CSSProperties = { fontSize: 11, color: 'var(--rd-muted)' }
const chartBox: React.CSSProperties = { width: '100%', height: 300 }
const kpiStyle: React.CSSProperties = { padding: '18px 4px' }
const kpiName: React.CSSProperties = { fontSize: 12, color: 'var(--rd-muted)' }
const kpiValue: React.CSSProperties = { fontSize: 36, fontWeight: 700, color: 'var(--rd-accent)' }
const kpiUnit: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--rd-muted)' }
const toolbar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const button: React.CSSProperties = {
  border: '1px solid var(--rd-border)', borderRadius: 999,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '3px 12px',
}
const details: React.CSSProperties = { fontSize: 12 }
const summary: React.CSSProperties = { cursor: 'pointer', color: 'var(--rd-accent)' }
const sqlBox: React.CSSProperties = {
  background: 'var(--rd-code-bg)', padding: 8, borderRadius: 6,
  whiteSpace: 'pre-wrap', overflowX: 'auto', margin: '4px 0 0',
}
