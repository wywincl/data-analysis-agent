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
import { zh, en, type HostLocale } from './i18n/host.ts'
import { tpl } from './i18n/index.ts'
import { formatLintIssues } from './semantic/lint.ts'
import { lintAgainstSchema } from './semantic/drift.ts'

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

function s(config: Config, key: keyof typeof zh): string {
  return config.locale === 'en' ? en[key] : zh[key]
}

export function registerCommands(ctx: Context, config: Config, registry: DataSourceRegistry, semantic: SemanticLayer): void {
  ctx.commands.register({
    name: 'data-sources',
    description: s(config, 'cmd.data-sources.desc'),
    recordInput: false,
    handler: (): CommandResult => {
      const sources = registry.list()
      if (sources.length === 0) return { kind: 'error', text: s(config, 'cmd.data-sources.noConfig') }
      const lines = sources.map((entry) => {
        const configured = config.dataSources.find((ds) => ds.name === entry.name)
        return `- ${entry.name} · ${entry.type} (${entry.dialect})${entry.mock ? ' · MOCK' : ''} · approval: ${configured?.approvalMode ?? 'auto'} · row cap: ${configured?.maxRows ?? config.defaultMaxRows}`
      })
      return { kind: 'success', text: tpl(s(config, 'cmd.data-sources.result'), { count: sources.length, sources: lines.join('\n') }) }
    },
  })

  ctx.commands.register({
    name: 'data-test',
    description: s(config, 'cmd.data-test.desc'),
    input: { hint: '<datasource>' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const datasource = invocation.rawInput.trim().split(/\s+/)[0]
      if (datasource === undefined || datasource === '') {
        return { kind: 'error', text: s(config, 'cmd.data-test.usage') }
      }
      const provider = registry.get(datasource)
      if (provider === undefined) return { kind: 'error', text: tpl(s(config, 'cmd.data-test.unknown'), { '0': datasource }) }
      const started = Date.now()
      try {
        const schema = await provider.introspect({ signal: undefined })
        const elapsed = Date.now() - started
        return { kind: 'success', text: tpl(s(config, 'cmd.data-test.success'), { name: datasource, type: provider.type, elapsed, tables: schema.tables.length }) }
      } catch (error) {
        return { kind: 'error', text: tpl(s(config, 'cmd.data-test.fail'), { name: datasource, type: provider.type, err: error instanceof Error ? error.message : String(error) }) }
      }
    },
  })

  ctx.commands.register({
    name: 'data-reload',
    description: s(config, 'cmd.data-reload.desc'),
    recordInput: false,
    handler: (): CommandResult => {
      if (semantic.file === undefined) {
        return { kind: 'error', text: s(config, 'cmd.data-reload.noFile') }
      }
      const error = semantic.reload()
      if (error !== undefined) return { kind: 'error', text: tpl(s(config, 'cmd.data-reload.fail'), { file: semantic.file, err: error }) }
      const catalog = semantic.catalog()
      const files = catalog.files.length > 1 ? tpl(s(config, 'cmd.data-reload.includeNote'), { count: catalog.files.length }) : ''
      const lint = catalog.issues.length > 0
        ? tpl(s(config, 'cmd.data-reload.lintWarn'), { count: catalog.issues.length })
        : s(config, 'cmd.data-reload.lintClean')
      return { kind: 'success', text: tpl(s(config, 'cmd.data-reload.success'), { file: semantic.file, files, metrics: catalog.metrics.length, entities: catalog.entities.length, terms: catalog.terms.length, lint }) }
    },
  })

  ctx.commands.register({
    name: 'data-semantic-lint',
    description: s(config, 'cmd.data-semantic-lint.desc'),
    recordInput: false,
    handler: (): CommandResult => {
      if (semantic.file === undefined) {
        return { kind: 'error', text: s(config, 'cmd.data-semantic-lint.noFile') }
      }
      const catalog = semantic.catalog()
      const header = tpl(s(config, 'cmd.data-semantic-lint.header'), { files: catalog.files.length, metrics: catalog.metrics.length, entities: catalog.entities.length, terms: catalog.terms.length })
      if (catalog.error !== undefined) {
        return { kind: 'error', text: tpl(s(config, 'cmd.data-semantic-lint.fail'), { err: catalog.error, header }) }
      }
      if (catalog.issues.length === 0) return { kind: 'success', text: tpl(s(config, 'cmd.data-semantic-lint.pass'), { header }) }
      const locale: HostLocale = config.locale === 'en' ? 'en' : 'zh'
      const lines = formatLintIssues(catalog.issues, locale).map((issue) => `- [${issue.code}] ${issue.path}\n    ${issue.message}${issue.hint !== undefined ? `\n    → ${issue.hint}` : ''}`)
      return {
        kind: 'success',
        text: tpl(s(config, 'cmd.data-semantic-lint.warnings'), { count: catalog.issues.length, header, lines: lines.join('\n') }),
      }
    },
  })

  ctx.commands.register({
    name: 'data-semantic-validate',
    description: s(config, 'cmd.data-semantic-validate.desc'),
    recordInput: false,
    handler: async (): Promise<CommandResult> => {
      if (semantic.file === undefined) {
        return { kind: 'error', text: s(config, 'cmd.data-semantic-validate.noFile') }
      }
      const catalog = semantic.catalog()
      if (catalog.error !== undefined) {
        return { kind: 'error', text: tpl(s(config, 'cmd.data-semantic-validate.loadFail'), { err: catalog.error }) }
      }
      // Validate each datasource the layer touches against its live schema.
      const sources = new Set<string>()
      for (const entity of catalog.entities) {
        const ds = entity.datasource ?? semantic.get().defaults?.datasource
        if (ds !== undefined) sources.add(ds)
      }
      const allIssues: { datasource: string, issue: ReturnType<typeof formatLintIssues>[number] }[] = []
      for (const datasource of sources) {
        const provider = registry.get(datasource)
        if (provider === undefined) {
          allIssues.push({ datasource, issue: { severity: 'warning', code: 'drift-table-missing', path: `datasource ${datasource}`, message: `数据源 "${datasource}" 未连接,跳过漂移校验`, hint: undefined } })
          continue
        }
        try {
          const schema = await registry.schema(datasource, { signal: undefined })
          const raw = lintAgainstSchema(semantic.get(), schema)
          const locale: HostLocale = config.locale === 'en' ? 'en' : 'zh'
          for (const view of formatLintIssues(raw, locale)) allIssues.push({ datasource, issue: view })
        } catch (error) {
          allIssues.push({ datasource, issue: { severity: 'warning', code: 'drift-table-missing', path: `datasource ${datasource}`, message: `内省失败: ${error instanceof Error ? error.message : String(error)}`, hint: undefined } })
        }
      }
      if (allIssues.length === 0) {
        return { kind: 'success', text: tpl(s(config, 'cmd.data-semantic-validate.pass'), { count: sources.size }) }
      }
      const lines = allIssues.map(({ datasource, issue }) => `- [${datasource}] ${issue.path}: ${issue.message}${issue.hint !== undefined ? ` → ${issue.hint}` : ''}`)
      return { kind: 'success', text: tpl(s(config, 'cmd.data-semantic-validate.warnings'), { count: allIssues.length, lines: lines.join('\n') }) }
    },
  })

  ctx.commands.register({
    name: 'data-schema',
    description: s(config, 'cmd.data-schema.desc'),
    input: { hint: '<datasource> [table]' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const [datasource, table] = invocation.rawInput.trim().split(/\s+/)
      if (datasource === undefined || datasource === '') {
        return { kind: 'error', text: s(config, 'cmd.data-schema.usage') }
      }
      const schema = await registry.schema(datasource, { signal: undefined })
      if (table !== undefined) {
        const found = schema.tables.find((entry) => entry.name.toLowerCase() === table.toLowerCase())
        if (found === undefined) return { kind: 'error', text: tpl(s(config, 'cmd.data-schema.notFound'), { table, ds: datasource }) }
        return { kind: 'success', text: `${found.name} [${found.type}]\n${found.columns.map((col) => `- ${col.name} ${col.dataType}${col.comment ? ` -- ${col.comment}` : ''}`).join('\n')}` }
      }
      const lines = schema.tables.slice(0, 60).map((entry) => `- ${entry.name} [${entry.type}] ${entry.columns.length} cols${entry.rowCountEstimate !== undefined ? ` ~${entry.rowCountEstimate} rows` : ''}`)
      const note = schema.tables.length > 60 ? `\n… ${schema.tables.length - 60} more tables` : ''
      return { kind: 'success', text: tpl(s(config, 'cmd.data-schema.result'), { ds: datasource, count: schema.tables.length, lines: lines.join('\n'), note }) }
    },
  })

  ctx.commands.register({
    name: 'data-sql',
    description: s(config, 'cmd.data-sql.desc'),
    input: { hint: '<datasource> <sql>' },
    recordInput: false,
    handler: async (invocation): Promise<CommandResult> => {
      const match = /^(\S+)\s+([\s\S]+)$/.exec(invocation.rawInput.trim())
      if (match === null) return { kind: 'error', text: s(config, 'cmd.data-sql.usage') }
      const [, datasource, sql] = match
      const provider = registry.get(datasource)
      if (provider === undefined) return { kind: 'error', text: tpl(s(config, 'cmd.data-sql.unknown'), { '0': datasource }) }
      try {
        const configured = config.dataSources.find((ds) => ds.name === datasource)
        const { timeoutMs, maxRows } = limitsFor(config, configured)
        const guarded = guardSelectOnly(sql, provider.dialect, maxRows)
        const result = await provider.query(guarded.sql, {
          timeoutMs,
          maxRows,
        })
        const note = result.truncated ? `\n(truncated to row cap; ${result.rowCount} rows matched)` : ''
        return { kind: 'success', text: tpl(s(config, 'cmd.data-sql.success'), { ds: datasource, count: result.rowCount, note, table: textTable(result.columns.map((col) => col.name), result.rows) }) }
      } catch (error) {
        return { kind: 'error', text: error instanceof GuardError || error instanceof Error ? error.message : String(error) }
      }
    },
  })

  ctx.commands.register({
    name: 'data-dashboard',
    description: s(config, 'cmd.data-dashboard.desc'),
    input: { hint: '[file-name]' },
    recordInput: false,
    handler: (invocation): CommandResult => {
      const charts = sessionCharts(invocation.agent?.session)
      if (charts.length === 0) {
        return { kind: 'error', text: s(config, 'cmd.data-dashboard.noCharts') }
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
        { title: name, echartsUmd, locale: config.locale === 'en' ? 'en' as const : 'zh' as const },
      )
      const dir = resolveExportDir(config)
      const file = join(dir, `${name}.html`)
      writeFileSync(file, html, 'utf8')
      return {
        kind: 'success',
        text: tpl(s(config, 'cmd.data-dashboard.success'), { file, count: charts.length }),
      }
    },
  })

  // CSV of the most recent query result, for /sql users who want the raw set.
  ctx.commands.register({
    name: 'data-csv',
    description: s(config, 'cmd.data-csv.desc'),
    input: { hint: '[file-name]' },
    recordInput: false,
    handler: (invocation): CommandResult => {
      const charts = sessionCharts(invocation.agent?.session)
      if (charts.length === 0) return { kind: 'error', text: s(config, 'cmd.data-csv.noResults') }
      const latest = charts[charts.length - 1]
      const name = (invocation.rawInput.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || `result-${Date.now()}`).replace(/^-+|-+$/g, '')
      const dir = resolveExportDir(config)
      const file = join(dir, `${name}.csv`)
      writeFileSync(file, toCsv([...latest.columns], [...latest.data]), 'utf8')
      return { kind: 'success', text: tpl(s(config, 'cmd.data-csv.success'), { file, count: latest.data.length }) }
    },
  })
}
