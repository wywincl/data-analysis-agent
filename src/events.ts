/**
 * Chart payload contract for the RD Data Analysis plugin.
 *
 * The render payload deliberately rides the DURABLE `tool/result` event's
 * `meta` (via the tool's `output.presentationMeta`) instead of a custom
 * session event type: out-of-tree event types are outside the harness'
 * persistence catalog by construction, and a log containing an unknown
 * REQUIRED type is refused wholesale on read. `tool/result` is a catalog
 * type, so the chart stays replayable everywhere and unknown-embedded
 * metadata costs nothing.
 *
 * @module dsh-rd-data-analysis/events
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { RdChartType } from './types.ts'

/** Durable chart payload persisted on the `tool/result` event meta (`meta.rdChart`). */
export interface RdChartEvent {
  /** Stable business identifier (uuid) — the conversation node id. */
  readonly chartId: string
  readonly title: string
  /** Datasource the chart data came from. */
  readonly datasource: string
  /** Provenance SQL, when the chart derives from a query. */
  readonly sql?: string
  /** High-level chart kind the model requested. */
  readonly chartType: RdChartType
  /** Complete, ready-to-render ECharts option (host-built, never model-authored). */
  readonly echartsOption: Record<string, JsonValue>
  /** Chart data rows (small result sets only, capped by config). */
  readonly data: readonly Record<string, JsonValue>[]
  readonly columns: readonly { readonly name: string, readonly type: string }[]
  readonly createdAt: string
}

/** Shape of the presentationMeta object the render_chart tool persists. */
export interface RdChartMeta {
  readonly rdChart: RdChartEvent
}

/** Extract a chart payload from a `tool/result` event's meta, if present. */
export function chartFromResultMeta(meta: unknown): RdChartEvent | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const chart = (meta as { rdChart?: unknown }).rdChart
  if (chart === null || typeof chart !== 'object') return undefined
  const candidate = chart as Partial<RdChartEvent>
  if (typeof candidate.chartId !== 'string' || typeof candidate.echartsOption !== 'object') return undefined
  return candidate as RdChartEvent
}
