/**
 * Model-facing tools for the RD Data Analysis plugin.
 *
 * Workflow the system prompt teaches: list_data_sources → inspect_schema →
 * run_sql → render_chart / analyze_data. All SQL passes the read-only guard
 * (see sql/guard.ts); chart option JSON is built host-side, never authored by
 * the model.
 *
 * @module dsh-research/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { limitsFor, type Config } from '../config.ts'
import type { DataSourceRegistry } from '../registry.ts'
import type { DataSourceProvider, RdChartType, RdChartTypeInput, RdSeriesInput } from '../types.ts'
import type { SemanticLayer } from '../semantic/layer.ts'
import type { JobStore } from '../jobs.ts'
import type { QueryAuditStore } from '../audit.ts'
import { guardSelectOnly, GuardError } from '../sql/guard.ts'
import { autoChartType, buildEchartsOption, optionDataPoints } from '../charts/echarts-option.ts'
import { correlation, distribution, insight, profile, topn, type AnalysisContext, type AnalysisKind } from '../analysis/analyze.ts'
import { textTable } from './text.ts'
import { zh, en } from '../i18n/host.ts'
import { tpl } from '../i18n/index.ts'

/** Lossless object schema for every canonical tool result (official pattern). */
function objectSchema() {
  return { type: 'object', additionalProperties: true } satisfies ValueSchemaSpec
}

function requireProvider(registry: DataSourceRegistry, datasource: string): DataSourceProvider {
  const provider = registry.get(datasource)
  if (provider === undefined) {
    const available = registry.list().map((entry) => entry.name).join(', ') || '(none configured)'
    throw new GuardError(`Unknown datasource "${datasource}". Configured: ${available}.`)
  }
  return provider
}

function s(config: Config, key: keyof typeof zh): string {
  return config.locale === 'en' ? en[key] : zh[key]
}

/** Register every tool; returns nothing (registrations are effects on ctx). */
export function registerTools(ctx: Context, config: Config, registry: DataSourceRegistry, semantic: SemanticLayer, jobs: JobStore, audit: QueryAuditStore): void {
  const { modelRowCap } = config

  /** Time a provider query and land it in the audit log (cost metering). */
  async function auditedQuery(
    kind: import('../audit.ts').AuditKind,
    provider: DataSourceProvider,
    sql: string,
    options: { timeoutMs: number, maxRows: number, signal?: AbortSignal },
    meta: Record<string, string> = {},
  ): Promise<import('../types.ts').QueryResult> {
    const started = Date.now()
    try {
      const result = await provider.query(sql, options)
      audit.record({
        kind,
        datasource: provider.name,
        sql,
        tablesTouched: undefined,
        rowCount: result.rowCount,
        durationMs: Date.now() - started,
        truncated: result.truncated,
        role: config.currentRole,
        meta,
      })
      return result
    } catch (error) {
      audit.record({
        kind,
        datasource: provider.name,
        sql,
        durationMs: Date.now() - started,
        role: config.currentRole,
        error: error instanceof Error ? error.message : String(error),
        meta,
      })
      throw error
    }
  }

  ctx.tools.register(defineTool({
    name: 'list_data_sources',
    description: s(config, 'tool.list_data_sources.desc'),
    parameters: {},
    output: {
      schema: objectSchema(),
      render: (_args, value) => [{
        type: 'text',
        text: (value as { dataSources: { name: string, type: string, dialect: string, mock: boolean, approvalMode: string }[] })
          .dataSources
          .map((entry) => `- ${entry.name} · ${entry.type} (${entry.dialect})${entry.mock ? ' · MOCK' : ''} · approval: ${entry.approvalMode}`)
          .join('\n') || '(no data sources configured)',
      }],
    },
    async execute() {
      const configured = new Map(config.dataSources.map((ds) => [ds.name, ds]))
      return {
        dataSources: registry.list().map((entry) => ({
          ...entry,
          approvalMode: configured.get(entry.name)?.approvalMode ?? 'auto',
        })),
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'inspect_schema',
    description: s(config, 'tool.inspect_schema.desc'),
    parameters: {
      datasource: { type: 'string', required: true, description: 'Data source name from list_data_sources.' },
      table: { type: 'string', description: 'Optional single table to detail (otherwise all tables are summarized).' },
      includeSamples: { type: 'boolean', description: 'Include up to 5 sample rows per table (slower).' },
      refresh: { type: 'boolean', description: 'Bypass the schema cache.' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => {
        const result = value as {
          datasource: string, tableCount: number, truncated: boolean,
          tables: { name: string, type: string, rowCountEstimate?: number, columns: string }[],
          sample?: Record<string, JsonValue>[]
        }
        const head = tpl(s(config, 'tool.inspect_schema.ok') || 'Schema of "{ds}" — {count} tables{truncated}:', { ds: result.datasource, count: result.tableCount, truncated: result.truncated ? ' (truncated)' : '' })
        const body = result.tables.map((table) =>
          `- ${table.name} [${table.type}]${table.rowCountEstimate !== undefined ? ` ~${table.rowCountEstimate} rows` : ''}\n    ${table.columns}`,
        ).join('\n')
        const sample = result.sample !== undefined ? `\n${s(config, 'tool.inspect_schema.samples')}:\n${textTable(Object.keys(result.sample[0] ?? {}), result.sample, 5)}` : ''
        return [{ type: 'text', text: `${head}\n${body}${sample}` }]
      },
    },
    async execute(args) {
      const provider = requireProvider(registry, args.datasource)
      const schema = await registry.schema(args.datasource, {
        includeSamples: args.includeSamples === true,
        refresh: args.refresh === true,
        signal: undefined,
      })
      // 语义层标注叠加:表/列的业务含义来自 semantic.yaml(meaning 层)。
      const annotate = (table: string): { tableLabel?: string, tableDescription?: string, columnMeta: Map<string, { label?: string, description?: string, unit?: string }> } => {
        const entity = semantic.entityFor(table)
        if (entity === undefined) return { columnMeta: new Map() }
        const columnMeta = new Map<string, { label?: string, description?: string, unit?: string }>()
        for (const column of entity.columns ?? []) columnMeta.set(column.name, column)
        return { ...(entity.label !== undefined ? { tableLabel: entity.label } : {}), ...(entity.description !== undefined ? { tableDescription: entity.description } : {}), columnMeta }
      }
      if (args.table !== undefined) {
        const table = schema.tables.find((entry) => entry.name.toLowerCase() === args.table!.toLowerCase())
        if (table === undefined) {
          throw new GuardError(`Table "${args.table}" not found in "${args.datasource}". Known: ${schema.tables.map((t) => t.name).join(', ')}`)
        }
        const { tableLabel, tableDescription, columnMeta } = annotate(table.name)
        return {
          datasource: schema.datasource,
          dialect: schema.dialect,
          tableCount: 1,
          truncated: false,
          tables: [{
            name: table.name,
            type: table.type,
            ...(tableLabel !== undefined ? { label: tableLabel } : {}),
            ...(tableDescription !== undefined ? { description: tableDescription } : {}),
            ...(table.rowCountEstimate !== undefined ? { rowCountEstimate: table.rowCountEstimate } : {}),
            columns: table.columns.map((column) => {
              const meta = columnMeta.get(column.name)
              return `${column.name} ${column.dataType}${column.nullable === false ? ' NOT NULL' : ''}${meta?.label !== undefined ? ` -- ${meta.label}` : column.comment ? ` -- ${column.comment}` : ''}${meta?.description !== undefined ? ` (${meta.description})` : ''}${meta?.unit !== undefined ? ` [${meta.unit}]` : ''}`
            }).join(', '),
          }],
          ...(table.samples !== undefined && table.samples.length > 0 ? { sample: table.samples } : {}),
        } as unknown as Record<string, JsonValue>
      }
      const maxTables = 200
      return {
        datasource: schema.datasource,
        dialect: schema.dialect,
        tableCount: schema.tables.length,
        truncated: schema.tables.length > maxTables,
        tables: schema.tables.slice(0, maxTables).map((table) => {
          const { tableLabel, tableDescription, columnMeta } = annotate(table.name)
          return {
            name: table.name,
            type: table.type,
            ...(tableLabel !== undefined ? { label: tableLabel } : {}),
            ...(tableDescription !== undefined ? { description: tableDescription } : {}),
            ...(table.rowCountEstimate !== undefined ? { rowCountEstimate: table.rowCountEstimate } : {}),
            ...(table.comment !== undefined && tableLabel === undefined ? { comment: table.comment } : {}),
            columns: table.columns.map((column) => {
              const meta = columnMeta.get(column.name)
              return `${column.name} ${column.dataType}${meta?.label !== undefined ? ` -- ${meta.label}` : column.comment ? ` -- ${column.comment}` : ''}${meta?.description !== undefined ? ` (${meta.description})` : ''}`
            }).join(', '),
          }
        }),
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'run_sql',
    description: s(config, 'tool.run_sql.desc'),
    parameters: {
      datasource: { type: 'string', required: true, description: 'Data source name.' },
      sql: { type: 'string', required: true, description: 'A single SELECT statement (dialect: see inspect_schema output).' },
      reason: { type: 'string', required: true, description: 'One sentence: what this query answers. Shown to the approver and in the audit trail.' },
      maxRows: { type: 'number', description: 'Row cap for this query (default: datasource setting).' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => {
        const result = value as {
          datasource: string, sql: string, rowCount: number, rows: Record<string, JsonValue>[],
          columns: { name: string }[], truncated: boolean, resultId: string
        }
        const columnsStr = result.columns.map((col) => col.name).join(', ')
        const note = result.truncated ? s(config, 'tool.run_sql.truncatedNote') : ''
        return [{
          type: 'text',
          text: tpl(s(config, 'tool.run_sql.ok'), { ds: result.datasource, count: result.rowCount, columns: columnsStr }) + note + '\n' +
            tpl(s(config, 'tool.run_sql.resultIdHint'), { rid: result.resultId }) + '\n' +
            textTable(result.columns.map((col) => col.name), result.rows),
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `SQL · ${args.datasource}`,
      kind: 'other' as const,
      rawInput: { datasource: args.datasource, reason: args.reason, sql: args.sql },
    }),
    async execute(args, exec) {
      const provider = requireProvider(registry, args.datasource)
      const configured = config.dataSources.find((ds) => ds.name === args.datasource)
      const { timeoutMs, maxRows: sourceMaxRows } = limitsFor(config, configured)
      const maxRows = Math.min(Math.max(args.maxRows ?? sourceMaxRows, 1), 10_000)
      const guarded = guardSelectOnly(args.sql, provider.dialect, maxRows)
      const result = await auditedQuery('run_sql', provider, guarded.sql, {
        timeoutMs,
        maxRows,
        signal: exec.signal,
      }, { reason: args.reason })
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
        datasource: provider.name,
        sql: guarded.sql,
        tablesTouched: guarded.tables,
        reason: args.reason,
        columns: result.columns,
        rows: result.rows.slice(0, modelRowCap),
        rowCount: result.rowCount,
        modelRowsShown: Math.min(result.rows.length, modelRowCap),
        truncated: result.truncated,
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'render_chart',
    description: s(config, 'tool.render_chart.desc'),
    parameters: {
      datasource: { type: 'string', required: true, description: 'Data source name (provenance).' },
      title: { type: 'string', required: true, description: 'Human chart title (Chinese when the user writes Chinese).' },
      chartType: {
        type: 'string', required: true, enum: ['auto', 'line', 'bar', 'pie', 'scatter', 'heatmap', 'kpi', 'boxplot', 'funnel'],
        description: 'auto: host infers the best family from the result shape (preferred). line/bar: category x + numeric series; pie: nameField+valueField; scatter: numeric x/y; heatmap: x+y category + value; kpi: single value; boxplot: category x + raw value column (quartiles per group); funnel: nameField+valueField stages.',
      },
      xField: { type: 'string', description: 'Category axis field (line/bar/heatmap) or x field (scatter).' },
      yFields: { type: 'array', items: { type: 'string' }, description: 'Value series fields for line/bar/scatter (each becomes a legend series).' },
      nameField: { type: 'string', description: 'pie: field carrying slice names.' },
      valueField: { type: 'string', description: 'pie: slice values; kpi: the single numeric field.' },
      unit: { type: 'string', description: 'kpi: display unit, e.g. "%", "元".' },
      sql: { type: 'string', description: 'A single SELECT executed fresh (when no resultId). Guardrails apply.' },
      resultId: { type: 'string', description: 'resultId from run_sql — rows come from the cached full result (preferred).' },
      data: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Inline rows (use when charting values not from run_sql).' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => [{
        type: 'text',
        text: tpl(s(config, 'tool.render_chart.rendered'), { cid: (value as { chartId: string }).chartId, points: (value as { points: number }).points }),
      }],
      presentationMeta: (_args, value): JsonValue => {
        const chart = (value as { chart?: Record<string, JsonValue> }).chart
        if (chart === undefined) return {}
        return { rdChart: chart }
      },
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `${s(config, 'tool.render_chart.cardPrefix')} · ${args.title}`,
      kind: 'other' as const,
      rawInput: { datasource: args.datasource, chartType: args.chartType, title: args.title },
    }),
    async execute(args, exec) {
      let rows: readonly Record<string, JsonValue>[] = []
      let columns: { name: string, type: string }[] = []
      let sql = args.sql
      if (typeof args.resultId === 'string') {
        const cached = registry.getResult(args.resultId)
        if (cached === undefined) {
          throw new GuardError(`resultId "${args.resultId}" expired or unknown — re-run run_sql, or pass sql / inline data instead.`)
        }
        rows = cached.rows as readonly Record<string, JsonValue>[]
        columns = cached.columns.map((col) => ({ ...col }))
        sql = sql ?? cached.sql
      } else if (typeof args.sql === 'string' && args.sql.trim() !== '') {
        const provider = requireProvider(registry, args.datasource)
        const configured = config.dataSources.find((ds) => ds.name === args.datasource)
        const guarded = guardSelectOnly(args.sql, provider.dialect, config.chartDataCap)
        const result = await auditedQuery('run_sql', provider, guarded.sql, {
          timeoutMs: configured?.timeoutMs ?? config.defaultTimeoutMs,
          maxRows: config.chartDataCap,
          signal: exec.signal,
        }, { reason: `render_chart: ${args.title}` })
        rows = result.rows as readonly Record<string, JsonValue>[]
        columns = result.columns.map((col) => ({ ...col }))
        sql = guarded.sql
      } else if (Array.isArray(args.data)) {
        rows = args.data
        columns = rows.length > 0 ? Object.keys(rows[0]).map((name) => ({ name, type: 'unknown' })) : []
      } else {
        throw new GuardError('Provide resultId (from run_sql), a sql SELECT, or inline data rows.')
      }
      const capped = rows.slice(0, config.chartDataCap)
      const series: RdSeriesInput[] = Array.isArray(args.yFields)
        ? (args.yFields as string[]).map((field) => ({ field }))
        : []
      const requestedType = args.chartType as RdChartTypeInput
      const resolvedType: RdChartType = requestedType === 'auto'
        ? autoChartType({
          data: capped,
          ...(args.xField !== undefined ? { xField: args.xField } : {}),
          ...(series.length > 0 ? { series } : {}),
          ...(args.nameField !== undefined ? { nameField: args.nameField } : {}),
          ...(args.valueField !== undefined ? { valueField: args.valueField } : {}),
        })
        : requestedType
      const option = buildEchartsOption({
        chartType: resolvedType,
        title: args.title,
        data: capped,
        ...(args.xField !== undefined ? { xField: args.xField } : {}),
        ...(series.length > 0 ? { series } : {}),
        ...(args.nameField !== undefined ? { nameField: args.nameField } : {}),
        ...(args.valueField !== undefined ? { valueField: args.valueField } : {}),
        ...(args.unit !== undefined ? { unit: args.unit } : {}),
      })
      const event = {
        chartId: crypto.randomUUID(),
        title: args.title,
        datasource: args.datasource,
        ...(sql !== undefined ? { sql } : {}),
        chartType: resolvedType,
        echartsOption: option,
        data: capped,
        columns,
        fields: {
          chartType: resolvedType,
          ...(args.xField !== undefined ? { xField: args.xField } : {}),
          ...(series.length > 0 ? { yFields: series.map((spec) => spec.field) } : {}),
          ...(args.nameField !== undefined ? { nameField: args.nameField } : {}),
          ...(args.valueField !== undefined ? { valueField: args.valueField } : {}),
        },
        createdAt: new Date().toISOString(),
      } as const
      return {
        chartId: event.chartId,
        chartType: resolvedType,
        autoResolved: requestedType === 'auto',
        points: optionDataPoints(option),
        rendered: true,
        chart: event,
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'analyze_data',
    description: s(config, 'tool.analyze_data.desc'),
    parameters: {
      datasource: { type: 'string', required: true, description: 'Data source name.' },
      analysis: {
        type: 'string', required: true, enum: ['profile', 'topn', 'correlation', 'distribution', 'insight'],
        description: 'Analysis kind. insight: headline stats + trend + top contributors with share + Pareto concentration + z-score outliers (dimension/metric/topN).',
      },
      sql: { type: 'string', required: true, description: 'Base SELECT (guardrails apply as in run_sql).' },
      column: { type: 'string', description: 'correlation: first column; distribution: the column.' },
      column2: { type: 'string', description: 'correlation: second column.' },
      dimension: { type: 'string', description: 'topn: group-by column; insight: group-by column for contributor shares.' },
      metric: { type: 'string', description: 'topn: aggregated column (omit for COUNT(*)); insight: measure column (omit to auto-detect the first numeric column).' },
      aggregate: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'topn: aggregation (default count / sum when metric given).' },
      topN: { type: 'number', description: 'topn: how many groups (default 10, max 100); insight: how many contributors (default 5, max 50).' },
      buckets: { type: 'number', description: 'distribution: bin count (default 12, max 60).' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => [{
        type: 'text',
        text: tpl(s(config, 'tool.analyze_data.complete'), { analysis: (value as { analysis: string }).analysis }) + '\n' + JSON.stringify(value, null, 2).slice(0, 6000),
      }],
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `${s(config, 'tool.analyze_data.cardPrefix')} · ${args.analysis}`,
      kind: 'other' as const,
      rawInput: { datasource: args.datasource, analysis: args.analysis, sql: args.sql },
    }),
    async execute(args, exec) {
      const provider = requireProvider(registry, args.datasource)
      const configured = config.dataSources.find((ds) => ds.name === args.datasource)
      const { timeoutMs } = limitsFor(config, configured)
      const guarded = guardSelectOnly(args.sql, provider.dialect, limitsFor(config, configured).maxRows)
      const ctx: AnalysisContext = {
        dialect: provider.dialect,
        run: (sql) => auditedQuery('analyze', provider, sql, {
          timeoutMs,
          maxRows: 20_000,
          signal: exec.signal,
        }, { analysis: args.analysis }),
      }
      const kind = args.analysis as AnalysisKind
      let result: Record<string, unknown>
      if (kind === 'profile') {
        result = await profile(ctx, guarded.sql)
      } else if (kind === 'topn') {
        if (args.dimension === undefined) throw new GuardError('topn requires "dimension".')
        result = await topn(ctx, guarded.sql, {
          dimension: args.dimension,
          ...(args.metric !== undefined ? { metric: args.metric } : {}),
          ...(args.aggregate !== undefined ? { aggregate: args.aggregate as 'count' | 'sum' | 'avg' | 'min' | 'max' } : {}),
          ...(args.topN !== undefined ? { topN: args.topN } : {}),
        })
      } else if (kind === 'correlation') {
        if (args.column === undefined || args.column2 === undefined) throw new GuardError('correlation requires "column" and "column2".')
        result = await correlation(ctx, guarded.sql, { column: args.column, column2: args.column2 })
      } else if (kind === 'distribution') {
        if (args.column === undefined) throw new GuardError('distribution requires "column".')
        result = await distribution(ctx, guarded.sql, {
          column: args.column,
          ...(args.buckets !== undefined ? { buckets: args.buckets } : {}),
        })
      } else {
        // insight — dimension and metric are both optional (metric auto-detects).
        result = await insight(ctx, guarded.sql, {
          ...(args.dimension !== undefined ? { dimension: args.dimension } : {}),
          ...(args.metric !== undefined ? { measure: args.metric } : {}),
          ...(args.topN !== undefined ? { topN: args.topN } : {}),
        })
      }
      return {
        analysis: kind,
        datasource: provider.name,
        baseSql: guarded.sql,
        ...result,
      } as unknown as Record<string, JsonValue>
    },
  }))

  // ── Async long-query jobs (③ datasources roadmap) ─────────────────────────
  // run_query_async → get_query_job → get_result_rows. Long / large queries
  // run in the background and are paged back, so a heavy Spark/warehouse scan
  // never blocks (or overflows) a single model turn. Async jobs deliberately
  // skip the interactive approval gate — the read-only guard still applies.

  ctx.tools.register(defineTool({
    name: 'run_query_async',
    description: s(config, 'tool.run_query_async.desc'),
    parameters: {
      datasource: { type: 'string', required: true, description: 'Data source name.' },
      sql: { type: 'string', required: true, description: 'A single SELECT statement (guardrails apply; LIMIT injected).' },
      reason: { type: 'string', required: true, description: 'One sentence: what this query answers (audit trail).' },
      maxRows: { type: 'number', description: 'Row cap stored for later paging (default: datasource setting).' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => {
        const job = value as { jobId: string, datasource: string, status: string }
        return [{
          type: 'text',
          text: tpl(s(config, 'tool.run_query_async.started'), { ds: job.datasource, jid: job.jobId, status: job.status }),
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic' as const,
      title: `SQL(异步) · ${args.datasource}`,
      kind: 'other' as const,
      rawInput: { datasource: args.datasource, reason: args.reason, sql: args.sql },
    }),
    async execute(args) {
      const provider = requireProvider(registry, args.datasource)
      const configured = config.dataSources.find((ds) => ds.name === args.datasource)
      const { timeoutMs, maxRows: sourceMaxRows } = limitsFor(config, configured)
      const maxRows = Math.min(Math.max(args.maxRows ?? sourceMaxRows, 1), 50_000)
      const guarded = guardSelectOnly(args.sql, provider.dialect, maxRows)
      const jobId = crypto.randomUUID()
      const job = jobs.start(jobId, provider, guarded.sql, { timeoutMs, maxRows }, guarded.tables)
      return {
        jobId: job.jobId,
        datasource: job.datasource,
        status: job.status,
        sql: guarded.sql,
        tablesTouched: guarded.tables,
        reason: args.reason,
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_query_job',
    description: s(config, 'tool.get_query_job.desc'),
    parameters: {
      jobId: { type: 'string', required: true, description: 'jobId from run_query_async.' },
      cancel: { type: 'boolean', description: 'true: request cancellation of a pending/running job.' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2).slice(0, 4000) }],
    },
    async execute(args) {
      if (args.cancel === true) {
        const cancelled = jobs.cancel(args.jobId)
        if (!cancelled) {
          throw new GuardError(`Job "${args.jobId}" is unknown, expired, or already finished — nothing to cancel.`)
        }
      }
      const job = jobs.get(args.jobId)
      if (job === undefined) {
        throw new GuardError(`Job "${args.jobId}" is unknown or expired (TTL ${config.asyncJobTtlMs} ms). Re-run run_query_async.`)
      }
      return {
        jobId: job.jobId,
        datasource: job.datasource,
        sql: job.sql,
        status: job.status,
        rowCount: job.rowCount,
        truncated: job.truncated,
        tablesTouched: job.tablesTouched,
        ...(job.error !== undefined ? { error: job.error } : {}),
        createdAt: new Date(job.createdAt).toISOString(),
        ...(job.finishedAt !== undefined ? { finishedAt: new Date(job.finishedAt).toISOString() } : {}),
      } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_result_rows',
    description: s(config, 'tool.get_result_rows.desc'),
    parameters: {
      jobId: { type: 'string', required: true, description: 'jobId from run_query_async (must have succeeded).' },
      offset: { type: 'number', description: 'Row offset (default 0).' },
      limit: { type: 'number', description: 'Page size (default 100, max 10000).' },
    },
    output: {
      schema: objectSchema(),
      render: (_args, value) => {
        const page = value as { jobId: string, status: string, total: number, offset: number, rows: Record<string, JsonValue>[], columns: { name: string }[] }
        return [{
          type: 'text',
          text: tpl(s(config, 'tool.get_result_rows.header'), { jid: page.jobId, status: page.status, total: page.total, count: page.rows.length }) + '\n' +
            textTable(page.columns.map((col) => col.name), page.rows),
        }]
      },
    },
    async execute(args) {
      const offset = args.offset ?? 0
      const limit = args.limit ?? 100
      const page = jobs.rows(args.jobId, offset, limit)
      if (page === undefined) {
        const job = jobs.get(args.jobId)
        if (job === undefined) {
          throw new GuardError(`Job "${args.jobId}" is unknown or expired (TTL ${config.asyncJobTtlMs} ms).`)
        }
        throw new GuardError(`Job "${args.jobId}" has status "${job.status}" — rows are only available once it succeeds. Poll with get_query_job.`)
      }
      return {
        jobId: page.jobId,
        status: page.status,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        columns: page.columns,
        rows: page.rows,
      } as unknown as Record<string, JsonValue>
    },
  }))
}
