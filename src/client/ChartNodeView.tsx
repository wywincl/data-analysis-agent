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

/** Live ECharts instance handle for PNG export. */
export interface ChartHandle {
  readonly getDataUrl: () => string
}

function KpiView({ event }: { event: RdChartEvent }): ReactNode {
  const kpi = event.echartsOption.kpi as { value?: number, unit?: string, name?: string } | undefined
  const value = typeof kpi?.value === 'number' ? kpi.value : null
  return (
    <div style={kpiStyle}>
      <div style={kpiName}>{event.title}</div>
      <div style={kpiValue}>
        {value === null ? '—' : value.toLocaleString('zh-CN')}
        {kpi?.unit ? <span style={kpiUnit}> {kpi.unit}</span> : null}
      </div>
    </div>
  )
}

/** Main node view: chart canvas + toolbar + SQL provenance. */
export function RdChartNodeView({ node }: ChatNodeViewProps<'rd-chart'>): ReactNode {
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

      {isKpi ? <KpiView event={event} /> : <div ref={containerRef} style={chartBox} />}

      <div style={toolbar}>
        <button type="button" style={button} onClick={() => downloadChartHtml(event)}>导出 HTML</button>
        {!isKpi && (
          <button type="button" style={button} onClick={() => downloadChartPng(event, handle()?.getDataUrl)}>PNG</button>
        )}
        <button type="button" style={button} onClick={() => downloadChartCsv(event)}>CSV</button>
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
            {copied ? '已复制 ✓' : '复制 SQL'}
          </button>
        )}
      </div>

      {event.sql !== undefined && (
        <details style={details}>
          <summary style={summary}>SQL</summary>
          <pre style={sqlBox}>{event.sql}</pre>
        </details>
      )}
    </div>
  )
}

const root: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 12,
  padding: '10px 14px', margin: '4px 0', background: 'var(--dsw-card-bg, transparent)',
  maxWidth: 720,
}
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const datasourceChip: React.CSSProperties = {
  fontSize: 11, color: 'var(--dsw-accent, #2f6feb)',
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 999, padding: '1px 8px',
}
const timestamp: React.CSSProperties = { fontSize: 11, color: 'var(--dsw-muted, #6b7280)' }
const chartBox: React.CSSProperties = { width: '100%', height: 300 }
const kpiStyle: React.CSSProperties = { padding: '18px 4px' }
const kpiName: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-muted, #6b7280)' }
const kpiValue: React.CSSProperties = { fontSize: 36, fontWeight: 700, color: 'var(--dsw-accent, #2f6feb)' }
const kpiUnit: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--dsw-muted, #6b7280)' }
const toolbar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const button: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 999,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '3px 12px',
}
const details: React.CSSProperties = { fontSize: 12 }
const summary: React.CSSProperties = { cursor: 'pointer', color: 'var(--dsw-accent, #2f6feb)' }
const sqlBox: React.CSSProperties = {
  background: 'var(--dsw-code-bg, #f3f4f6)', padding: 8, borderRadius: 6,
  whiteSpace: 'pre-wrap', overflowX: 'auto', margin: '4px 0 0',
}
