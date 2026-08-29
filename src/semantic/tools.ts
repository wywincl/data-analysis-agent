/**
 * Semantic layer tools: `list_semantic` (catalog view) and `query_metric`
 * (governed metric → guarded SQL → rows + resultId for render_chart).
 *
 * @module dsh-rd-data-analysis/semantic/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { limitsFor, type Config } from '../config.ts'
import type { DataSourceRegistry } from '../registry.ts'
import type { SemanticLayer } from './layer.ts'
import { guardSelectOnly, GuardError } from '../sql/guard.ts'
import { textTable } from '../tools/text.ts'

/** Register the semantic-layer tools (no-op when no semanticFile is set — the catalog tools still explain how to enable it). */
export function registerSemanticTools(ctx: Context, config: Config, registry: DataSourceRegistry, semantic: SemanticLayer): void {
  ctx.tools.register(defineTool({
    name: 'list_semantic',
    description:
      'List the semantic layer catalog (语义层): governed metrics with their口径 (formula/grain/dimensions/unit), '
      + 'business terms, and table/column business labels. Prefer these governed metrics over hand-written SQL '
      + 'whenever a question maps to one. Pass the metric name to query_metric.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true } as const,
      render: (_args, value) => {
        const result = value as {
          metrics: { name: string, label?: string, agg: string, measure?: string, entity: string, resolvedDatasource: string, formula?: string, grain?: string, dimensions?: string[], filters?: string[], unit?: string, timeField?: string }[]
          terms: { name: string, aliases?: string[], description: string }[]
          entities: { table: string, label?: string, description?: string }[]
          error?: string, file?: string
        }
        const parts: string[] = []
        if (result.error !== undefined) parts.push(`⚠️ 语义层加载错误(沿用上一次有效配置): ${result.error}`)
        if (result.file === undefined) parts.push('(未配置语义层文件 — 在工作台卡片或配置里设置 semanticFile 启用)')
        if (result.metrics.length > 0) {
          parts.push('Governed metrics 指标目录:')
          parts.push(result.metrics.map((metric) => {
            const dims = metric.dimensions?.length ? ` | dims: ${metric.dimensions.join('/')}` : ''
            const time = metric.timeField !== undefined ? ` | time: ${metric.timeField}` : ''
            return `- ${metric.name} — ${metric.label ?? metric.name} [${metric.resolvedDatasource}] ${metric.agg}(${metric.measure ?? '*'}) on ${metric.entity}${time}${dims}${metric.unit !== undefined ? ` | unit: ${metric.unit}` : ''}${metric.formula !== undefined ? `\n    口径: ${metric.formula}` : ''}${metric.grain !== undefined ? ` | grain: ${metric.grain}` : ''}${metric.filters?.length ? `\n    固定过滤: ${metric.filters.join(' AND ')}` : ''}`
          }).join('\n'))
        }
        if (result.terms.length > 0) {
          parts.push('Business terms 业务术语:\n' + result.terms.map((term) => `- ${term.name}${term.aliases?.length ? ` (aka ${term.aliases.join('/')})` : ''}: ${term.description}`).join('\n'))
        }
        if (result.entities.length > 0) {
          parts.push('Entities 业务表:\n' + result.entities.map((entity) => `- ${entity.table}${entity.label !== undefined ? ` · ${entity.label}` : ''}${entity.description !== undefined ? ` — ${entity.description}` : ''}`).join('\n'))
        }
        return [{ type: 'text', text: parts.join('\n\n') || 'Semantic layer is empty.' }]
      },
    },
    async execute() {
      return semantic.catalog() as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_metric',
    description:
      'Query a GOVERNED metric from the semantic layer (统一口径, audit-safe). Builds the SQL from the metric '
      + 'definition — you only pick the metric id, optional declared dimensions, dimension value filters, and an '
      + 'optional from/to time range. Returns rows plus a resultId for render_chart. Prefer this over run_sql '
      + 'whenever a list_semantic metric matches the question.',
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
        const result = value as {
          metric: string, datasource: string, sql: string, columns: { name: string, label: string }[],
          rows: Record<string, JsonValue>[], rowCount: number, truncated: boolean, resultId: string
        }
        const note = result.truncated ? '\nNote: result filled the row cap — there may be more rows.' : ''
        return [{
          type: 'text',
          text: `Metric "${result.metric}" OK on "${result.datasource}" — ${result.rowCount} rows.${note}\n`
            + `resultId: ${result.resultId}  ← pass THIS to render_chart\n`
            + `SQL (generated from the governed definition):\n${result.sql}\n\n`
            + textTable(result.columns.map((column) => column.name), result.rows),
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `指标查询 · ${args.metric}`,
      kind: 'other' as const,
      rawInput: { metric: args.metric, ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}), ...(args.from !== undefined || args.to !== undefined ? { range: `${args.from ?? '…'} ~ ${args.to ?? '…'}` } : {}) },
    }),
    async execute(args, exec) {
      const resolved = semantic.resolveMetric(args.metric)
      const provider = registry.get(resolved.datasource)
      if (provider === undefined) {
        throw new GuardError(`Metric "${args.metric}" resolves to datasource "${resolved.datasource}" which is not configured. Fix the semantic layer or add the connection.`)
      }
      const built = semantic.buildMetricSql(args.metric, {
        ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
        ...(args.filters !== undefined ? { filters: args.filters as Record<string, string | number | boolean | readonly (string | number)[]> } : {}),
        ...(args.from !== undefined ? { from: args.from } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }, provider.dialect)
      // Safety net: the generated SQL goes through the same read-only guard.
      const configured = config.dataSources.find((ds) => ds.name === resolved.datasource)
      const { timeoutMs, maxRows } = limitsFor(config, configured)
      const guarded = guardSelectOnly(built.sql, provider.dialect, maxRows)
      const result = await provider.query(guarded.sql, {
        timeoutMs,
        maxRows,
        signal: exec.signal,
      })
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
