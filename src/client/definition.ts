/**
 * Conversation Node definition for RD Data Analysis charts (browser half).
 *
 * Charts ride the durable `tool/result` event's `meta.rdChart` (written by
 * the render_chart tool's `output.presentationMeta`) — a catalog-known event
 * type, so replay works in any harness build without custom event vocabulary.
 * The stable business `chartId` is the node id: replay, pagination, and live
 * append all rebuild the same node without scanning the session window. The
 * renderer consumes only `node.data` — see the Conversation Node cookbook.
 *
 * @module dsh-data-analysis/client/definition
 */

import type { ChatConversationViewNode, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chartFromResultMeta, type RdChartEvent } from '../events.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One RD Data Analysis chart: a complete, self-contained ECharts payload. */
    'rd-chart': RdChartEvent
  }
}

/** State carried for one chart context: the durable payload plus its anchor seq. */
interface RdChartState {
  readonly seq: number
  readonly chart: RdChartEvent
}

/** Conversation Node definition rendering RD Data Analysis charts. */
export const rdChartDefinition: ConversationNodeDefinition<RdChartState> = {
  kind: 'rd-chart',
  target: 'chat',
  match(event): { id: string, role: 'start' | 'update' } | null {
    if (event.type !== 'tool/result') return null
    const chart = chartFromResultMeta((event.data as { meta?: unknown }).meta)
    if (chart === undefined) return null
    return { id: chart.chartId, role: 'start' }
  },
  start(context, match): RdChartState {
    const chart = chartFromResultMeta((match.event.data as { meta?: unknown }).meta)
    if (chart === undefined) {
      // match() gated this start; the guard only satisfies the type checker.
      throw new Error(`rd-chart: tool/result seq ${match.event.seq} lost its chart payload`)
    }
    return { seq: match.event.seq, chart }
  },
  update(context): RdChartState {
    return context.state
  },
  buildViewNode(context): ChatConversationViewNode | null {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'rd-chart',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state.chart,
    }
  },
}

export type { ChatNodeViewProps }
