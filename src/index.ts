/**
 * RD Data Analysis plugin for DeepSeek Harness — host half.
 *
 * A database workbench + data analysis agent platform: multi-datasource
 * connectivity (SQLite, MySQL, PostgreSQL, ClickHouse, Spark seam), text2SQL
 * with parse-level guardrails and per-source approval, a hot-reloadable
 * semantic layer (语义层: entities/terms/metrics), built-in statistical
 * analysis, in-chat interactive ECharts visualization, and self-contained
 * HTML/PNG/CSV chart export. Connections and the semantic file are editable
 * live from the Web settings card (工作台).
 *
 * The browser half (./client) registers the chart Conversation Node and the
 * workbench settings card.
 *
 * @module dsh-rd-data-analysis
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, PLUGIN_NAME, validateConfig, type Config as ConfigType } from './config.ts'
import { DataSourceRegistry } from './registry.ts'
import { createSqliteProvider } from './datasources/sqlite.ts'
import { createMysqlProvider } from './datasources/mysql.ts'
import { createPostgresProvider } from './datasources/postgres.ts'
import { createClickhouseProvider } from './datasources/clickhouse.ts'
import { createSparkMockProvider } from './datasources/spark.ts'
import { SemanticLayer } from './semantic/layer.ts'
import { registerSemanticTools } from './semantic/tools.ts'
import { registerTools } from './tools/index.ts'
import { registerCommands } from './commands.ts'
import { registerApprovalGate } from './approval.ts'
import { workflowSectionText } from './prompt.ts'

export { PLUGIN_NAME } from './config.ts'
export type { RdChartEvent } from './events.ts'
export type { DataSourceProvider, QueryResult, SchemaInfo } from './types.ts'
export type { SemanticConfig, SemanticMetric, SemanticEntity, SemanticTerm } from './semantic/types.ts'

/** Cordis plugin name. */
export const name = PLUGIN_NAME
/** Required services: tool registry, command registry, system prompt. */
export const inject = ['tools', 'commands', 'systemPrompt']

export { Config }

/** Settings namespace backing the Web workbench card (连接管理). */
export const SETTINGS_NS = settingsNamespace(PLUGIN_NAME)

/** Instantiate the provider for one configured datasource. */
function createProvider(ds: ConfigType['dataSources'][number]): import('./types.ts').DataSourceProvider {
  switch (ds.type) {
    case 'sqlite':
      return createSqliteProvider(ds.name, ds.file!)
    case 'mysql':
      return createMysqlProvider(ds.name, {
        host: ds.host!, database: ds.database!,
        ...(ds.port !== undefined ? { port: ds.port } : {}),
        ...(ds.user !== undefined ? { user: ds.user } : {}),
        ...(ds.password !== undefined ? { password: ds.password } : {}),
        ...(ds.ssl !== undefined ? { ssl: ds.ssl } : {}),
      })
    case 'postgres':
      return createPostgresProvider(ds.name, {
        host: ds.host!, database: ds.database!,
        ...(ds.port !== undefined ? { port: ds.port } : {}),
        ...(ds.user !== undefined ? { user: ds.user } : {}),
        ...(ds.password !== undefined ? { password: ds.password } : {}),
        ...(ds.ssl !== undefined ? { ssl: ds.ssl } : {}),
      })
    case 'clickhouse':
      return createClickhouseProvider(ds.name, {
        host: ds.host!, database: ds.database!,
        ...(ds.port !== undefined ? { port: ds.port } : {}),
        ...(ds.user !== undefined ? { user: ds.user } : {}),
        ...(ds.password !== undefined ? { password: ds.password } : {}),
      })
    case 'spark':
      // v1: mock. Real Livy / Spark Connect backends implement the same
      // DataSourceProvider seam — see src/datasources/spark.ts header.
      return createSparkMockProvider(ds.name)
  }
}

/**
 * Plugin entry. All registrations are Cordis effects and clean up on unload;
 * provider pools close through ctx.effect. The Web workbench card edits the
 * settings namespace live: connections hot-swap, the semantic file rewires —
 * no restart.
 */
export function apply(ctx: Context, config: ConfigType): void {
  validateConfig(config)

  const registry = new DataSourceRegistry(
    config.schemaCacheTtlMs,
    config.resultCacheTtlMs,
    config.resultCacheSize,
  )
  const semantic = new SemanticLayer(config.semanticFile === '' ? undefined : config.semanticFile)
  ctx.effect(() => () => {
    void registry.close()
    semantic.dispose()
  })

  /** (Re)mount providers from the live config; close the previous set. */
  let wired: import('./types.ts').DataSourceProvider[] = []
  const wireDataSources = (): void => {
    const active = new Set(config.dataSources.map((ds) => ds.name))
    for (const provider of wired) {
      if (!active.has(provider.name)) provider.close().catch(() => { /* best-effort close */ })
    }
    wired = []
    registry.dropAll()
    for (const ds of config.dataSources) {
      try {
        const provider = createProvider(ds)
        registry.register(provider)
        wired.push(provider)
      } catch (error) {
        ctx.logger?.error?.(error)
      }
    }
  }
  wireDataSources()

  registerTools(ctx, config, registry, semantic)
  registerSemanticTools(ctx, config, registry, semantic)
  registerApprovalGate(ctx, config)
  registerCommands(ctx, config, registry, semantic)

  // Web workbench card: the settings namespace mirrors the plugin config.
  // Writes hot-swap connections (providers rebuild) and rewire the semantic
  // layer file — everything else the closures already read live.
  let source: () => ConfigType = () => config
  installSettingsSection(ctx, SETTINGS_NS, Config as unknown as Schema<ConfigType>, config, {
    setSource: (get) => { source = get },
    onChange: () => {
      const next = source()
      // Compare connection SHAPE excluding secret passwords — settings reads
      // may strip `role('secret')` fields, which would otherwise make a
      // scalar-only edit (e.g. global defaults) trigger a needless rebuild.
      const shape = (ds: ConfigType['dataSources'][number]): string => JSON.stringify({ ...ds, password: undefined })
      const connectionsChanged = JSON.stringify(next.dataSources.map(shape)) !== JSON.stringify(config.dataSources.map(shape))
      const semanticChanged = next.semanticFile !== config.semanticFile
      // Secret fields (role('secret')) may come back absent from a settings
      // read — carry stored passwords over so a card save never drops them.
      const stored = new Map(config.dataSources.map((ds) => [ds.name, ds]))
      const merged = {
        ...next,
        dataSources: next.dataSources.map((ds) => {
          const previous = stored.get(ds.name)
          return ds.password === undefined && previous?.password !== undefined
            ? { ...ds, password: previous.password }
            : ds
        }),
      }
      Object.assign(config, merged)
      if (connectionsChanged) wireDataSources()
      if (semanticChanged) semantic.reconfigure(config.semanticFile === '' ? undefined : config.semanticFile)
    },
    validate: (value) => validateConfig(value),
  })

  // The section text is evaluated at each assembly, so semantic-layer terms
  // and metrics stay current across hot reloads without a plugin reload.
  ctx.systemPrompt.section({
    name: 'rd-data-analysis-workflow',
    order: 110,
    text: () => {
      const digest = semantic.promptDigest()
      return workflowSectionText(config) + (digest !== '' ? `\n\n## Semantic layer (语义层)\n\n${digest}\nWhen a governed metric matches the question, call query_metric — never rebuild its SQL by hand. If the user asks to govern new metrics/labels, propose edits to the semantic file (${config.semanticFile !== '' ? config.semanticFile : 'enable semanticFile in the workbench card'}) and they hot-reload.` : '')
    },
  })
}
