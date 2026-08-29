/**
 * RD Data Analysis plugin, browser half.
 *
 * Registers (1) the `rd-chart` Conversation Node — interactive ECharts with
 * HTML/PNG/CSV export, replayed from the durable `tool/result` meta — and
 * (2) the 数据库工作台 settings card for live connection management. The host
 * half owns data access, guardrails, the semantic layer, and option building;
 * this half only renders and edits settings.
 *
 * @module dsh-rd-data-analysis/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { Component, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only contract pulls: the settingsScope Context merge and the
// `settings.section` SlotMap entry (both from ui-settings).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { rdChartDefinition } from './definition.ts'
import { RdChartNodeView } from './ChartNodeView.tsx'
import { DataWorkbenchCard, type WorkbenchSection } from './settings-card.tsx'

/** Render boundary: one broken card must not blank out the whole card list. */
class RdCardBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(error: unknown): void {
    // Console-only: keep the rest of the settings UI alive and diagnosable.
    console.error('[rd-data-analysis] workbench card render error:', error)
  }
  render(): ReactNode {
    return this.state.error === null ? this.props.children : null
  }
}

/** Required client services: node registry, chat slots, and the settings scope. */
export const inject = ['conversationEvents', 'slots', 'settingsScope']

/**
 * Register the chart node, its renderer, and the workbench settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(rdChartDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'rd-chart', locale: 'conversation' },
    RdChartNodeView,
  ))

  // 数据库工作台: a dedicated top-level Settings section (设置 → 数据库工作台),
  // not a card inside the Plugins tab. Binds the plugin's settings namespace;
  // the key equals the Host namespace (settings join key per the cookbook).
  const scope = ctx.settingsScope.bind({ namespace: 'rd-data-analysis' }) as SettingsScope<WorkbenchSection>
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'data-workbench',
    order: 12, // nav position: general(0) < models(10) < data-workbench(12) < plugins(15) < agent-presets(20)
    label: () => '数据库工作台',
  }, () => <RdCardBoundary><DataWorkbenchCard scope={scope} /></RdCardBoundary>))
}

export { rdChartDefinition } from './definition.ts'
export { RdChartNodeView } from './ChartNodeView.tsx'
export { DataWorkbenchCard } from './settings-card.tsx'
