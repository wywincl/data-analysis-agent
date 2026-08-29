/**
 * Human slash commands. Results render in the UI and never enter model
 * history (registry contract), so these are operator conveniences: check
 * sources, peek schema, run one guarded query, export the session dashboard.
 *
 * @module dsh-research/commands
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { limitsFor, type Config } from './config.ts'
import type { DataSourceRegistry } from './registry.ts'
import type { SemanticLayer } from './semantic/layer.ts'
import { chartFromResultMeta, type RdChartEvent } from './events.ts'
import { guardSelectOnly, GuardError } from './sql/guard.ts'
import { renderStandaloneHtml, toCsv } from './shared/export-template.ts'
import echartsUmd from 'echarts-umd-text'

/** Collect this session's charts from the durable log (survives restarts). */
function sessionCharts(session: { readonly events: readonly unknown[] } | undefined): RdChartEvent[] {
  const events = session?.events ?? []
  return events
    .map((event) => event as { type?: string, data?: unknown })
    .filter((event) => event.type === 'tool/result')
    .map((event) => chartFromResultMeta((event.data as { meta?: unknown } | undefined)?.meta))
    .filter((chart): chart is RdChartEvent => chart !== undefined)
}

function textTable(columns: readonly string[], rows: readonly Record<string, unknown>[], maxRows = 20): string {
  if (rows.length === 0) return '(no rows)'
  const lines = rows.slice(0, maxRows).map((row) => columns.map((column) => {
    const value = row[column]
    return value === null || value === undefined ? '∅' : String(value)
  }).join(' | '))
  const note = rows.length > maxRows ? `\n… ${rows.length - maxRows} more rows` : ''
  return `${columns.join(' | ')}\n${lines.join('\n')}${note}`
}

function resolveExportDir(config: Config): string {
  if (config.exportDir !== '') return config.exportDir
  const downloads = join(homedir(), 'Downloads', 'dsh-exports')
  try {
    mkdirSync(downloads, { recursive: true })
    return downloads
  } catch { /* Downloads may not exist on servers */ }
  const fallback = join(tmpdir(), 'dsh-exports')
  mkdirSync(fallback, { recursive: true })
  return fallback
}

export function registerCommands(ctx: Context, config: Config, registry: DataSourceRegistry, semantic: SemanticLayer): void {
  ctx.commands.register({
    name: 'data-sources',
    description: 'list configured data sources and their status',
    recordInput: false,
    handler: (): CommandResult => {
      const sources = registry.list()
      if (sources.length === 0) return { kind: 'error', text: 'No data sources configured. Add them in the workbench card (设置 → 数据库工作台) or the plugin config (dataSources).' }
      const lines = sources.map((entry) => {
        const configured = config.dataSources.find((ds) => ds.name === entry.name)
        return `- ${entry.name} · ${entry.type} (${entry.dialect})${entry.mock ? ' · MOCK' : ''} · approval: ${configured?.approvalMode ?? 'auto'} · row cap: ${configured?.maxRows ?? config.defaultMaxRows}`
      })
      return { kind: 'success', text: `Data sources (${sources.length}):\n${lines.join('\n')}` }
    },
  })

  ctx.commands.register({
    name: 'data-test',
    description: 'test one data source connection (introspection round-trip)',
    input: { hint: '<datasource>' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const datasource = invocation.rawInput.trim().split(/\s+/)[0]
      if (datasource === undefined || datasource === '') {
        return { kind: 'error', text: 'Usage: /data-test <datasource>' }
      }
      const provider = registry.get(datasource)
      if (provider === undefined) return { kind: 'error', text: `Unknown datasource "${datasource}". Try /data-sources.` }
      const started = Date.now()
      try {
        const schema = await provider.introspect({ signal: undefined })
        const elapsed = Date.now() - started
        return { kind: 'success', text: `✓ ${datasource} (${provider.type}) connected in ${elapsed}ms — ${schema.tables.length} tables/views.` }
      } catch (error) {
        return { kind: 'error', text: `✗ ${datasource} (${provider.type}) failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })

  ctx.commands.register({
    name: 'data-reload',
    description: 'reload the semantic layer file (also hot-reloads on save)',
    recordInput: false,
    handler: (): CommandResult => {
      if (semantic.file === undefined) {
        return { kind: 'error', text: 'No semantic file configured — set semanticFile in the workbench card (设置 → 数据库工作台).' }
      }
      const error = semantic.reload()
      if (error !== undefined) return { kind: 'error', text: `Semantic layer reload FAILED (kept last good config):\n${error}` }
      const catalog = semantic.catalog()
      return { kind: 'success', text: `✓ Semantic layer reloaded from ${semantic.file}: ${catalog.metrics.length} metrics, ${catalog.entities.length} entities, ${catalog.terms.length} terms.` }
    },
  })

  ctx.commands.register({
    name: 'data-schema',
    description: 'show tables/columns of a data source',
    input: { hint: '<datasource> [table]' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const [datasource, table] = invocation.rawInput.trim().split(/\s+/)
      if (datasource === undefined || datasource === '') {
        return { kind: 'error', text: 'Usage: /data-schema <datasource> [table]' }
      }
      const schema = await registry.schema(datasource, { signal: undefined })
      if (table !== undefined) {
        const found = schema.tables.find((entry) => entry.name.toLowerCase() === table.toLowerCase())
        if (found === undefined) return { kind: 'error', text: `Table "${table}" not found in "${datasource}".` }
        return { kind: 'success', text: `${found.name} [${found.type}]\n${found.columns.map((col) => `- ${col.name} ${col.dataType}${col.comment ? ` -- ${col.comment}` : ''}`).join('\n')}` }
      }
      const lines = schema.tables.slice(0, 60).map((entry) => `- ${entry.name} [${entry.type}] ${entry.columns.length} cols${entry.rowCountEstimate !== undefined ? ` ~${entry.rowCountEstimate} rows` : ''}`)
      const note = schema.tables.length > 60 ? `\n… ${schema.tables.length - 60} more tables` : ''
      return { kind: 'success', text: `${datasource}: ${schema.tables.length} tables\n${lines.join('\n')}${note}` }
    },
  })

  ctx.commands.register({
    name: 'data-sql',
    description: 'run one read-only SELECT directly (result stays out of model history)',
    input: { hint: '<datasource> <sql>' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const match = /^(\S+)\s+([\s\S]+)$/.exec(invocation.rawInput.trim())
      if (match === null) return { kind: 'error', text: 'Usage: /data-sql <datasource> <select statement>' }
      const [, datasource, sql] = match
      const provider = registry.get(datasource)
      if (provider === undefined) return { kind: 'error', text: `Unknown datasource "${datasource}". Try /data-sources.` }
      try {
        const configured = config.dataSources.find((ds) => ds.name === datasource)
        const { timeoutMs, maxRows } = limitsFor(config, configured)
        const guarded = guardSelectOnly(sql, provider.dialect, maxRows)
        const result = await provider.query(guarded.sql, {
          timeoutMs,
          maxRows,
        })
        const note = result.truncated ? `\n(truncated to row cap; ${result.rowCount} rows matched)` : ''
        return { kind: 'success', text: `OK — ${result.rowCount} rows${note}\n${textTable(result.columns.map((col) => col.name), result.rows)}` }
      } catch (error) {
        return { kind: 'error', text: error instanceof GuardError || error instanceof Error ? error.message : String(error) }
      }
    },
  })

  ctx.commands.register({
    name: 'data-dashboard',
    description: 'export all charts of this session as one self-contained HTML dashboard',
    input: { hint: '[file-name]' },
    recordInput: false,
    handler: (invocation): CommandResult => {
      const charts = sessionCharts(invocation.agent?.session)
      if (charts.length === 0) {
        return { kind: 'error', text: 'No charts to export yet — ask the agent to render a chart first.' }
      }
      const name = (invocation.rawInput.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || `dashboard-${Date.now()}`).replace(/^-+|-+$/g, '')
      const html = renderStandaloneHtml(
        charts.map((chart) => ({
          title: chart.title,
          datasource: chart.datasource,
          sql: chart.sql,
          createdAt: chart.createdAt,
          echartsOption: chart.echartsOption,
          data: chart.data,
          columns: [...chart.columns],
        })),
        { title: name, echartsUmd },
      )
      const dir = resolveExportDir(config)
      const file = join(dir, `${name}.html`)
      writeFileSync(file, html, 'utf8')
      return {
        kind: 'success',
        text: `Dashboard exported: ${file}\n${charts.length} charts, self-contained (works offline). Tip: each chart node in the chat also has per-chart HTML/PNG/CSV export buttons.`,
      }
    },
  })

  // CSV of the most recent query result, for /sql users who want the raw set.
  ctx.commands.register({
    name: 'data-csv',
    description: 'export the latest query result as CSV',
    input: { hint: '[file-name]' },
    recordInput: false,
    handler: (invocation): CommandResult => {
      const charts = sessionCharts(invocation.agent?.session)
      if (charts.length === 0) return { kind: 'error', text: 'No cached results in this session yet.' }
      const latest = charts[charts.length - 1]
      const name = (invocation.rawInput.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || `result-${Date.now()}`).replace(/^-+|-+$/g, '')
      const dir = resolveExportDir(config)
      const file = join(dir, `${name}.csv`)
      writeFileSync(file, toCsv([...latest.columns], [...latest.data]), 'utf8')
      return { kind: 'success', text: `CSV exported: ${file} (${latest.data.length} rows)` }
    },
  })
}
