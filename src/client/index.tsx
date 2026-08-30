/**
 * RD Data Analysis plugin, browser half.
 *
 * Registers (1) the `rd-chart` Conversation Node — interactive ECharts with
 * HTML/PNG/CSV export, replayed from the durable `tool/result` meta — and
 * (2) the 数据库工作台 settings card for live connection management. The host
 * half owns data access, guardrails, the semantic layer, and option building;
 * this half only renders and edits settings.
 *
 * @module dsh-data-analysis/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { Component, type ReactNode, createContext, useContext } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { rdChartDefinition } from './definition.ts'
import { RdChartNodeView } from './ChartNodeView.tsx'
import { DataWorkbenchCard, type WorkbenchSection } from './settings-card.tsx'
import { zh, en, type ClientKey } from '../i18n/client.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'rd-data': ClientKey
  }
}

const NS = 'rd-data'

type Translate = (key: ClientKey, params?: Record<string, unknown>) => string

const LocaleContext = createContext<Translate>(() => '')

function useLocale(): Translate {
  return useContext(LocaleContext)
}

/** Render boundary: one broken card must not blank out the whole card list. */
class RdCardBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(error: unknown): void {
    console.error('[data-analysis] workbench card render error:', error)
  }
  render(): ReactNode {
    return this.state.error === null ? this.props.children : null
  }
}

/** Required client services: node registry, chat slots, settings scope, and i18n. */
export const inject = ['conversationEvents', 'slots', 'settingsScope', 'locale']

/**
 * Register the chart node, its renderer, and the workbench settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const locale = (ctx as unknown as { locale?: { register: (ns: string, dicts: { zh: Record<string, string>, en: Record<string, string> }) => void; bind: (ns: string) => Translate } }).locale
  if (locale !== undefined) {
    locale.register(NS, { zh, en })
  }

  ctx.conversationEvents.register(rdChartDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'rd-chart', locale: 'rd-data' as any },
    RdChartNodeView as any,
  ))

  const scope = ctx.settingsScope.bind({ namespace: 'data-analysis' }) as SettingsScope<WorkbenchSection>
  const t = locale !== undefined ? locale.bind(NS) : ((key: ClientKey) => {
    const stored = (scope.getSnapshot().value as { locale?: string } | undefined)?.locale
    const dict = stored === 'en' ? en : zh
    return dict[key] ?? key
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'data-workbench',
    order: 12,
    label: () => t('settings.title'),
  }, () => <RdCardBoundary><DataWorkbenchCard scope={scope} t={t} /></RdCardBoundary>))
}

export { rdChartDefinition } from './definition.ts'
export { RdChartNodeView } from './ChartNodeView.tsx'
export { DataWorkbenchCard } from './settings-card.tsx'
