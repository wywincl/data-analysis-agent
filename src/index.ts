/**
 * RD Data Analysis plugin for DeepSeek Harness — host half.
 *
 * A database workbench + data analysis agent platform: multi-datasource
 * connectivity (SQLite, MySQL, PostgreSQL, ClickHouse, Spark seam), text2SQL
 * with parse-level guardrails and per-source approval, a hot-reloadable
 * semantic layer (语义层: entities/terms/metrics — composable across files
 * via `include`, reusable via `extends` and level defaults, hot-reloaded over
 * the whole include graph, health-checked after every load), built-in
 * statistical analysis, in-chat interactive ECharts visualization, and
 * self-contained HTML/PNG/CSV chart export. Connections and the semantic file
 * are editable live from the Web settings card (工作台).
 *
 * The browser half (./client) registers the chart Conversation Node and the
 * workbench settings card.
 *
 * @module dsh-data-analysis
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, PLUGIN_NAME, validateConfig, type Config as ConfigType } from './config.ts'
import { DataSourceRegistry } from './registry.ts'
import { createSqliteProvider } from './datasources/sqlite.ts'
import { createMysqlProvider } from './datasources/mysql.ts'
import { createPostgresProvider } from './datasources/postgres.ts'
import { createClickhouseProvider } from './datasources/clickhouse.ts'
import { createSparkMockProvider } from './datasources/spark.ts'
import { createSparkLivyProvider } from './datasources/spark-livy.ts'
import { createDuckdbProvider } from './datasources/duckdb.ts'
import { probeProvider } from './datasources/probe.ts'
import { JobStore } from './jobs.ts'
import { QueryAuditStore } from './audit.ts'
import type { HealthStatus } from './health.ts'
import { SemanticLayer } from './semantic/layer.ts'
import { registerSemanticTools } from './semantic/tools.ts'
import { registerTools } from './tools/index.ts'
import { registerCommands } from './commands.ts'
import { registerApprovalGate } from './approval.ts'
import { workflowSectionText, semanticDigestPrefix, semanticSectionTitle } from './prompt.ts'

export { PLUGIN_NAME } from './config.ts'
export type { RdChartEvent } from './events.ts'
export type { DataSourceProvider, QueryResult, SchemaInfo } from './types.ts'
export type { SemanticConfig, SemanticMetric, SemanticEntity, SemanticTerm, SemanticDefaults, LintIssue, LintCode } from './semantic/types.ts'
export { lintSemanticConfig } from './semantic/lint.ts'
import { buildSemanticSummary } from './semantic/summary.ts'
import { scaffoldFromIntrospection } from './semantic/scaffold.ts'
import { configToYaml, ensureWorkbenchInclude, workbenchPathFor, writeSemanticFile } from './semantic/serialize.ts'
import type { HostLocale } from './i18n/host.ts'
import type { SemanticConfig } from './semantic/types.ts'

/** Cordis plugin name. */
export const name = PLUGIN_NAME
/** Required services: tool registry, command registry, system prompt, settings store. */
export const inject = ['tools', 'commands', 'systemPrompt', 'settings']

/**
 * Stable JSON serialization (recursively key-sorted). Used for the workbench
 * round-trip guard: the settings scope re-serializes objects it stores, and a
 * plain `JSON.stringify` then never matches the same logical content with a
 * different key order — which would re-persist the echo forever.
 */
function jsonOf(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v !== null && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
        out[key] = sort((v as Record<string, unknown>)[key])
        return out
      }, {})
    }
    return v
  }
  return JSON.stringify(sort(value))
}

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
        ...(ds.sslSkipVerify !== undefined ? { sslSkipVerify: ds.sslSkipVerify } : {}),
      })
    case 'postgres':
      return createPostgresProvider(ds.name, {
        host: ds.host!, database: ds.database!,
        ...(ds.port !== undefined ? { port: ds.port } : {}),
        ...(ds.user !== undefined ? { user: ds.user } : {}),
        ...(ds.password !== undefined ? { password: ds.password } : {}),
        ...(ds.ssl !== undefined ? { ssl: ds.ssl } : {}),
        ...(ds.sslSkipVerify !== undefined ? { sslSkipVerify: ds.sslSkipVerify } : {}),
      })
    case 'clickhouse':
      return createClickhouseProvider(ds.name, {
        host: ds.host!, database: ds.database!,
        ...(ds.port !== undefined ? { port: ds.port } : {}),
        ...(ds.user !== undefined ? { user: ds.user } : {}),
        ...(ds.password !== undefined ? { password: ds.password } : {}),
      })
    case 'spark':
      // v1 default: mock. Set sparkMock:false + livyUrl to use a real Livy
      // REST backend (same DataSourceProvider seam).
      if (ds.sparkMock === false) {
        if (ds.livyUrl === undefined) throw new Error(`data-analysis: spark datasource "${ds.name}" has sparkMock:false but no livyUrl`)
        return createSparkLivyProvider(ds.name, { livyUrl: ds.livyUrl, ...(ds.user !== undefined ? { user: ds.user } : {}) })
      }
      return createSparkMockProvider(ds.name)
    case 'duckdb':
      // Native driver is optional; imported lazily and fails with a clear hint.
      return createDuckdbProvider(ds.name, ds.file)
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
  const audit = new QueryAuditStore(config.auditMaxEntries)
  const jobs = new JobStore(config.asyncJobTtlMs, config.asyncJobCacheSize, (job) => {
    // Async jobs audit at settlement (succeeded / failed / cancelled).
    // reason/role are snapshotted at submission — the settle callback can
    // fire long after the submitting turn (and its role) is gone.
    audit.record({
      kind: 'async',
      datasource: job.datasource,
      sql: job.sql,
      tablesTouched: job.tablesTouched,
      rowCount: job.rowCount,
      durationMs: (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt),
      truncated: job.truncated,
      role: job.role ?? config.currentRole,
      ...(job.error !== undefined ? { error: job.error } : {}),
      meta: { jobId: job.jobId, status: job.status, ...(job.reason !== undefined ? { reason: job.reason } : {}) },
    })
  })
  const semantic = new SemanticLayer(config.semanticFile !== '' && existsSync(config.semanticFile) ? config.semanticFile : undefined, () => { pushSemanticSummary() })
  if (config.semanticFile !== '' && !existsSync(config.semanticFile)) {
    // A configured-but-missing path previously degraded to "layer disabled"
    // with no signal — the prompt hint then misreported it as "not enabled".
    ctx.logger?.error?.(`[data-analysis] semanticFile "${config.semanticFile}" does not exist — semantic layer stays disabled until the path is fixed`)
  }
  ctx.effect(() => () => {
    void registry.close()
    void jobs.close()
    semantic.dispose()
  })

  /** (Re)mount providers from the live config; close the previous set. */
  let wired: import('./types.ts').DataSourceProvider[] = []
  /** Last `testRequest.nonce` the plugin has already consumed (loop guard). */
  let lastProbeNonce = 0
  /** Whether the settings namespace is live — gates auto-probes (avoid early throws). */
  let settingsReady = false
  /** Whether the initial connection + semantic seed has been pushed (runs once the namespace registers). */
  let seeded = false
  /** Last `scaffoldRequest.nonce` the plugin has already consumed (loop guard). */
  let lastScaffoldNonce = 0
  /** Last serialized `semanticWorkbench` echoed back — guards the round-trip. */
  let lastWorkbenchJson = jsonOf(config.semanticWorkbench ?? null)

  /** Build and push the read-only semantic preview to the card. */
  function pushSemanticSummary(): void {
    if (!settingsReady) return
    const locale: HostLocale = config.locale === 'en' ? 'en' : 'zh'
    const summary = buildSemanticSummary(semantic, locale)
    try { ctx.settings.update(SETTINGS_NS, { semanticSummary: summary }) } catch { /* surface already logged */ }
  }

  /** Resolve a live provider for a datasource (reuse wired, else build temp). */
  const getProviderFor = async (name: string): Promise<{ provider: import('./types.ts').DataSourceProvider, temporary: boolean } | undefined> => {
    const existing = registry.get(name)
    if (existing !== undefined) return { provider: existing, temporary: false }
    const ds = config.dataSources.find((d) => d.name === name)
    if (ds === undefined) return undefined
    try {
      return { provider: createProvider(ds), temporary: true }
    } catch (error) {
      const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      ctx.logger?.error?.(`[data-analysis] provider build failed for ${name}: ${msg}`)
      return undefined
    }
  }

  /**
   * Persist authored semantic content to the dedicated workbench file and
   * rewire the layer. Non-destructive: writes its own file and (when a root
   * exists) appends an include rather than touching operator files.
   */
  /** True when a workbench config carries no definitions (all three lists empty). */
  const isWorkbenchEmpty = (content: SemanticConfig): boolean =>
    (content.entities ?? []).length === 0 && (content.metrics ?? []).length === 0 && (content.terms ?? []).length === 0

  const persistWorkbench = (content: SemanticConfig): void => {
    // Never persist an entirely-empty workbench. An empty write is (a) useless —
    // it adds nothing to the loaded layer — and (b) the seed of an echo
    // ping-pong: paired with a non-empty persist (e.g. the startup scaffold),
    // the two queued settings writes flip the resolved value, and each flip
    // re-enters onChange with the OTHER value, which persistWorkbench then
    // re-writes, forever. Suppressing empty writes everywhere removes the
    // unstable writer; the in-memory mirror below still shows the echo so the
    // UI matches. Clearing the editor therefore keeps the last non-empty file
    // on disk, which contributes nothing until new content is authored.
    if (isWorkbenchEmpty(content)) {
      config.semanticWorkbench = content
      lastWorkbenchJson = jsonOf(content)
      return
    }
    const wbPath = workbenchPathFor(config.semanticFile, process.cwd())
    let rootChanged = false
    try {
      writeSemanticFile(wbPath, configToYaml(content))
      if (config.semanticFile !== '') {
        ensureWorkbenchInclude(config.semanticFile, wbPath)
      } else {
        config.semanticFile = wbPath
        rootChanged = true
      }
    } catch (error) {
      // Without this log a failed write looks exactly like a successful save
      // in the UI — the operator's edits would silently never reach disk.
      const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      ctx.logger?.error?.(`[data-analysis] workbench persist failed (${wbPath}): ${msg}`)
      return
    }
    semantic.reconfigure(config.semanticFile === '' || !existsSync(config.semanticFile) ? undefined : config.semanticFile)
    config.semanticWorkbench = content
    lastWorkbenchJson = jsonOf(content)
    if (settingsReady) {
      try {
        ctx.settings.update(SETTINGS_NS, {
          ...(rootChanged ? { semanticFile: wbPath } : {}),
          semanticWorkbench: content,
        })
      } catch (error) {
        // surface already logged by the settings layer
      }
    }
    pushSemanticSummary()
  }

  /** Introspect a datasource and scaffold a starter workbench config. */
  const runScaffold = async (datasource: string): Promise<void> => {
    const resolved = await getProviderFor(datasource)
    if (resolved === undefined) {
      ctx.logger?.error?.(`[data-analysis] scaffold skipped: datasource "${datasource}" is unknown or failed to build`)
      return
    }
    const { provider, temporary } = resolved
    try {
      const schema = await provider.introspect()
      const content = scaffoldFromIntrospection(schema, datasource)
      persistWorkbench(content)
    } catch (error) {
      const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      ctx.logger?.error?.(`[data-analysis] scaffold failed for ${datasource}: ${msg}`)
    } finally {
      // Temporarily-built providers (pool-backed) must not leak per scaffold run.
      if (temporary) await provider.close().catch(() => { /* best-effort close */ })
    }
  }

  /**
   * Probe one or more datasources and push the results into the `health` map.
   * Uses the already-wired provider when present; otherwise builds a temporary
   * one from the saved config (and closes it). A single settings write carries
   * the whole map, so watchers settle once.
   */
  const probeNames = async (names: string[]): Promise<void> => {
    // Start from the current config's names only — entries for datasources
    // deleted from the card would otherwise linger in the health map forever.
    const activeNames = new Set(config.dataSources.map((ds) => ds.name))
    const next: Record<string, HealthStatus> = Object.fromEntries(
      Object.entries(config.health ?? {}).filter(([name]) => activeNames.has(name)),
    )
    for (const name of names) {
      const ds = config.dataSources.find((d) => d.name === name)
      if (ds === undefined) {
        next[name] = { online: false, message: 'not configured (save the connection first)', at: Date.now() }
        continue
      }
      const existing = registry.get(name)
      let provider = existing
      let temporary = false
      if (provider === undefined) {
        try {
          provider = createProvider(ds)
          temporary = true
        } catch (buildError) {
          next[name] = { online: false, message: buildError instanceof Error ? buildError.message : String(buildError), at: Date.now() }
          continue
        }
      }
      next[name] = await probeProvider(provider, config.defaultTimeoutMs)
      if (temporary) await provider.close().catch(() => { /* best-effort close */ })
    }
    config.health = next
    if (settingsReady) {
      try { await ctx.settings.update(SETTINGS_NS, { health: next }) } catch { /* surface already logged via health */ }
    }
  }

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
    // Auto-probe the freshly wired connections so the card shows live status.
    if (settingsReady) void probeNames(wired.map((p) => p.name))
  }
  wireDataSources()

  registerTools(ctx, config, registry, semantic, jobs, audit)
  registerSemanticTools(ctx, config, registry, semantic, audit)
  registerApprovalGate(ctx, config, semantic)
  registerCommands(ctx, config, registry, semantic, audit)

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
      // Consume a one-shot connectivity test request (card → host). A new nonce
      // fires exactly one probe; the resulting health write re-enters onChange
      // with the SAME nonce, so it terminates after a single extra settle.
      const probeReq = merged.testRequest
      if (probeReq !== null && probeReq !== undefined && typeof probeReq.nonce === 'number' && probeReq.nonce !== lastProbeNonce) {
        lastProbeNonce = probeReq.nonce
        if (config.dataSources.some((ds) => ds.name === probeReq.name)) {
          void probeNames([probeReq.name])
        }
      }
      if (connectionsChanged) wireDataSources()
      if (semanticChanged) semantic.reconfigure(config.semanticFile === '' ? undefined : config.semanticFile)

      // Consume a one-shot semantic scaffold request (card → host). A new nonce
      // fires exactly one scaffold; the resulting workbench write re-enters
      // onChange with the SAME nonce, so it terminates after a single settle.
      // The request is also CLEARED from the store after consumption: the
      // nonce guard starts at 0 every boot, so a stale request persisted in
      // settings would otherwise re-fire (and re-shadow the workbench file)
      // on every startup.
      const scaffoldReq = merged.scaffoldRequest
      if (scaffoldReq !== null && scaffoldReq !== undefined && typeof scaffoldReq.nonce === 'number' && scaffoldReq.nonce !== lastScaffoldNonce) {
        lastScaffoldNonce = scaffoldReq.nonce
        try { ctx.settings.update(SETTINGS_NS, { scaffoldRequest: null }) } catch { /* namespace not registered yet */ }
        if (config.dataSources.some((ds) => ds.name === scaffoldReq.datasource)) {
          void runScaffold(scaffoldReq.datasource)
        }
      }

      // Consume workbench authoring (card → host). Guarded against the echo we
      // push back so it runs exactly once per save and then settles. The echo
      // re-serializes with a different key order, so both sides are compared
      // in canonical (key-sorted) form.
      const wbJson = jsonOf(merged.semanticWorkbench ?? null)
      if (wbJson !== lastWorkbenchJson) {
        lastWorkbenchJson = wbJson
        if (merged.semanticWorkbench !== undefined && merged.semanticWorkbench !== null) {
          persistWorkbench(merged.semanticWorkbench as SemanticConfig)
        }
      }

      // Seed once the namespace is live. installSettingsSection registers the
      // namespace inside its own deferred ctx.inject callback and then calls
      // this hook, so the `update` calls below are safe here. A synchronous
      // seed during `apply` would throw "namespace not registered" because the
      // registration is deferred until after `apply` returns.
      if (!seeded) {
        seeded = true
        settingsReady = true
        void probeNames(wired.map((p) => p.name))
        pushSemanticSummary()
      }
    },
    validate: (value) => validateConfig(value),
  })

  // The section text is evaluated at each assembly, so semantic-layer terms
  // and metrics stay current across hot reloads without a plugin reload.
  ctx.systemPrompt.section({
    name: 'data-analysis-workflow',
    order: 110,
    text: () => {
      const digest = semantic.promptDigest()
      const semanticTitle = semanticSectionTitle(config)
      const semanticPrefix = semanticDigestPrefix(config)
      const semanticFileHint = config.semanticFile === ''
        ? 'semantic layer not enabled — set semanticFile in the workbench card'
        : existsSync(config.semanticFile)
          ? config.semanticFile
          : `semanticFile "${config.semanticFile}" does not exist (check the path in the workbench card)`
      return workflowSectionText(config) + (digest !== '' ? `\n\n${semanticTitle}\n\n${digest}\n${semanticPrefix} ${semanticFileHint}` : '')
    },
  })
}
