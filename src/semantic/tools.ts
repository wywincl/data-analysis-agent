/**
 * Semantic layer tools: `list_semantic` (catalog view) and `query_metric`
 * (governed metric → guarded SQL → rows + resultId for render_chart).
 *
 * @module dsh-data-analysis/semantic/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { limitsFor, type Config } from '../config.ts'
import type { DataSourceRegistry } from '../registry.ts'
import type { SemanticLayer } from './layer.ts'
import type { LintIssue } from './types.ts'
import { guardSelectOnly, GuardError } from '../sql/guard.ts'
import type { QueryAuditStore } from '../audit.ts'
import { textTable } from '../tools/text.ts'
import { zh, en, type HostLocale } from '../i18n/host.ts'
import { formatLintIssues } from './lint.ts'
import { tpl } from '../i18n/index.ts'

/** Register the semantic-layer tools (no-op when no semanticFile is set — the catalog tools still explain how to enable it). */
export function registerSemanticTools(ctx: Context, config: Config, registry: DataSourceRegistry, semantic: SemanticLayer, audit: QueryAuditStore): void {
  function s(key: keyof typeof zh): string {
    return config.locale === 'en' ? en[key] : zh[key]
  }

  ctx.tools.register(defineTool({
    name: 'list_semantic',
    description: s('tool.list_semantic.desc'),
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true } as const,
      render: (_args, value) => {
        const result = value as unknown as {
          metrics: { name: string, label?: string, agg: string, measure?: string, entity: string, resolvedDatasource: string, formula?: string, grain?: string, dimensions?: string[], filters?: string[], unit?: string, timeField?: string }[]
          terms: { name: string, aliases?: string[], description: string }[]
          entities: { table: string, label?: string, description?: string }[]
          issues?: LintIssue[]
          files?: string[]
          error?: string, file?: string
        }
        const locale: HostLocale = config.locale === 'en' ? 'en' : 'zh'
        const s = (key: keyof typeof zh): string => locale === 'en' ? en[key] : zh[key]
        const parts: string[] = []
        if (result.error !== undefined) parts.push(`⚠️ ${s('tool.list_semantic.error')}: ${result.error}`)
        if (result.file === undefined) parts.push(s('tool.list_semantic.noFile'))
        if ((result.issues?.length ?? 0) > 0) {
          parts.push(`⚠️ ${tpl(s('tool.list_semantic.lintWarn'), { count: result.issues!.length })}`)
          parts.push(formatLintIssues(result.issues!, locale).map((issue) => `- [${issue.code}] ${issue.path}\n    ${issue.message}${issue.hint !== undefined ? `\n    → ${issue.hint}` : ''}`).join('\n'))
        }
        if (result.metrics.length > 0) {
          parts.push(s('tool.list_semantic.metricsHeader'))
          parts.push(result.metrics.map((metric) => {
            const dims = metric.dimensions?.length ? ` | dims: ${metric.dimensions.join('/')}` : ''
            const time = metric.timeField !== undefined ? ` | time: ${metric.timeField}` : ''
            return `- ${metric.name} — ${metric.label ?? metric.name} [${metric.resolvedDatasource}] ${metric.agg}(${metric.measure ?? '*'}) on ${metric.entity}${time}${dims}${metric.unit !== undefined ? ` | unit: ${metric.unit}` : ''}${metric.formula !== undefined ? `\n    ${s('tool.list_semantic.formula')}: ${metric.formula}` : ''}${metric.grain !== undefined ? ` | grain: ${metric.grain}` : ''}${metric.filters?.length ? `\n    ${s('tool.list_semantic.filters')}: ${metric.filters.join(' AND ')}` : ''}`
          }).join('\n'))
        }
        if (result.terms.length > 0) {
          parts.push(s('tool.list_semantic.termsHeader'))
          parts.push(result.terms.map((term) => `- ${term.name}${term.aliases?.length ? ` (aka ${term.aliases.join('/')})` : ''}: ${term.description}`).join('\n'))
        }
        if (result.entities.length > 0) {
          parts.push(s('tool.list_semantic.entitiesHeader'))
          parts.push(result.entities.map((entity) => `- ${entity.table}${entity.label !== undefined ? ` · ${entity.label}` : ''}${entity.description !== undefined ? ` — ${entity.description}` : ''}`).join('\n'))
        }
        if ((result.files?.length ?? 0) > 1) {
          parts.push(tpl(s('tool.list_semantic.filesHeader'), { count: result.files!.length }))
          parts.push(result.files!.map((file) => `- ${file}`).join('\n'))
        }
        return [{ type: 'text', text: parts.join('\n\n') || s('tool.list_semantic.empty') }]
      },
    },
    async execute() {
      return semantic.catalog() as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_metric',
    description: s('tool.query_metric.desc'),
    parameters: {
      metric: { type: 'string', required: true, description: 'Metric id from list_semantic.' },
      dimensions: { type: 'array', items: { type: 'string' }, description: 'Declared dimensions to group by (omit for the time series default).' },
      filters: { type: 'object', additionalProperties: true, description: 'Equality filters on DECLARED dimensions, e.g. { "status": "paid" } or { "city": ["杭州","上海"] }.' },
      from: { type: 'string', description: 'Inclusive time range lower bound on the metric timeField, e.g. 2026-03-01.' },
      to: { type: 'string', description: 'Inclusive time range upper bound.' },
      limit: { type: 'number', description: 'Row cap for this query (default 500, max 5000).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true } as const,
      render: (_args, value) => {
        const result = value as unknown as {
          metric: string, datasource: string, sql: string, columns: { name: string, label: string }[],
          rows: Record<string, JsonValue>[], rowCount: number, truncated: boolean, resultId: string
        }
        const note = result.truncated ? '\nNote: result filled the row cap — there may be more rows.' : ''
        return [{
          type: 'text',
          text: s('tool.query_metric.render.success')
            .replace('{metric}', result.metric)
            .replace('{ds}', result.datasource)
            .replace('{count}', String(result.rowCount))
            .replace('{note}', note)
            .replace('{rid}', result.resultId)
            .replace('{sql}', result.sql)
            .replace('{table}', textTable(result.columns.map((column) => column.name), result.rows)),
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `${s('tool.query_metric.cardPrefix')} · ${args.metric}`,
      kind: 'other' as const,
      rawInput: { metric: args.metric, ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}), ...(args.from !== undefined || args.to !== undefined ? { range: `${args.from ?? '…'} ~ ${args.to ?? '…'}` } : {}) },
    }),
    async execute(args, exec) {
      const resolved = semantic.resolveMetric(args.metric)
      const provider = registry.get(resolved.datasource)
      if (provider === undefined) {
        throw new GuardError(s('tool.query_metric.missingDatasource').replace('{metric}', args.metric).replace('{ds}', resolved.datasource))
      }
      const built = semantic.buildMetricSql(args.metric, {
        ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
        ...(args.filters !== undefined ? { filters: args.filters as Record<string, string | number | boolean | readonly (string | number)[]> } : {}),
        ...(args.from !== undefined ? { from: args.from } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        locale: config.locale === 'en' ? 'en' as const : 'zh' as const,
      }, provider.dialect, { currentRole: config.currentRole !== '' ? config.currentRole : undefined })
      const configured = config.dataSources.find((ds) => ds.name === resolved.datasource)
      const { timeoutMs, maxRows } = limitsFor(config, configured)
      const guarded = guardSelectOnly(built.sql, provider.dialect, maxRows)
      const started = Date.now()
      let result: Awaited<ReturnType<typeof provider.query>>
      try {
        result = await provider.query(guarded.sql, {
          timeoutMs,
          maxRows,
          signal: exec.signal,
        })
        audit.record({
          kind: 'query_metric',
          datasource: provider.name,
          sql: guarded.sql,
          rowCount: result.rowCount,
          durationMs: Date.now() - started,
          truncated: result.truncated,
          role: config.currentRole,
          meta: { metric: args.metric },
        })
      } catch (error) {
        audit.record({
          kind: 'query_metric',
          datasource: provider.name,
          sql: guarded.sql,
          durationMs: Date.now() - started,
          role: config.currentRole,
          error: error instanceof Error ? error.message : String(error),
          meta: { metric: args.metric },
        })
        throw error
      }
      const resultId = crypto.randomUUID()
      registry.putResult({
        resultId,
        datasource: provider.name,
        dialect: provider.dialect,
        sql: guarded.sql,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      })
      return {
        resultId,
        metric: args.metric,
        datasource: provider.name,
        sql: guarded.sql,
        columns: built.columns,
        rows: result.rows.slice(0, config.modelRowCap),
        rowCount: result.rowCount,
        truncated: result.truncated,
      } as unknown as Record<string, JsonValue>
    },
  }))
}
