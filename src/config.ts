/**
 * Plugin configuration (Schemastery).
 *
 * Design rule (docs/user/develop/basic/config.md): anything two deployments
 * may set differently is a config field. Credentials are supplied through the
 * patch layer with `!!js` expressions so secrets never live in the source
 * tree, e.g.  password: !!js process.env.MYSQL_PASSWORD
 *
 * @module dsh-rd-data-analysis/config
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { en, zh } from './i18n/host.ts'
import { tpl } from './i18n/index.ts'
import type { HealthStatus } from './health.ts'
import type { SemanticSummary, SemanticConfig } from './semantic/types.ts'

/** Per-datasource execution policy. */
export type ApprovalMode = 'auto' | 'ask'

/** One configured datasource connection. */
export interface DataSourceConfig {
  /** Registry key the model references in tools. */
  name: string
  type: 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark'
  /** SQLite database file path (`type: 'sqlite'`). */
  file?: string
  /** mysql/postgres: host; clickhouse: HTTP base like `http://ck-prod`. */
  host?: string
  port?: number
  user?: string
  /** Supply via `!!js process.env.*`; never hardcode. */
  password?: string
  /** Database/schema name (mysql/postgres/clickhouse). */
  database?: string
  /** SSL mode (postgres: `require` / `disable`, mysql: boolean-compatible). */
  ssl?: boolean
  /** Ask for human approval before every query on this source. Default auto. */
  approvalMode?: ApprovalMode
  /** Per-source row cap; falls back to `defaultMaxRows`. */
  maxRows?: number
  /** Per-source statement timeout; falls back to `defaultTimeoutMs`. */
  timeoutMs?: number
  /** Placeholder flag honored by the spark provider (v1 ships mock only). */
  sparkMock?: boolean
}

export interface Config {
  dataSources: DataSourceConfig[]
  /**
   * Datasource the model should prefer when the user does not name one.
   * Empty = the model picks from `dataSources` (usually the only source).
   */
  defaultDatasource: string
  /**
   * Live connectivity probe results, keyed by datasource name. The plugin
   * writes this after each (re)wire and after every manual test request; the
   * settings card renders the online/offline indicator from it. Not user
   * editable.
   */
  health?: Record<string, HealthStatus>
  /**
   * One-shot connectivity test request written by the settings card; the
   * plugin consumes it (probes the named source) and never echoes it back.
   * `nonce` changes drive the single fire.
   */
  testRequest?: { name: string, nonce: number } | null
  /**
   * Read-only preview of the semantic layer, pushed live by the plugin after
   * every reload. The settings card renders status / counts / metric list /
   * lint issues from it. Host-owned; not user editable.
   */
  semanticSummary?: SemanticSummary
  /**
   * User-authored semantic content owned by the workbench editor. The card
   * writes the edited model here; the plugin serializes it to the dedicated
   * workbench file and rewires the layer, then echoes it back so the card
   * reflects the saved state.
   */
  semanticWorkbench?: SemanticConfig
  /**
   * One-shot scaffold request written by the settings card; the plugin
   * introspects the named datasource and generates a starter workbench file.
   * `nonce` changes drive the single fire.
   */
  scaffoldRequest?: { datasource: string, nonce: number } | null
  /**
   * Absolute path to the semantic layer YAML (语义层: entities/terms/metrics).
   * Empty disables the layer. Hot-reloaded on file change.
   */
  semanticFile: string
  /** Hard row cap for any query result when the source does not override. */
  defaultMaxRows: number
  /** Statement timeout when the source does not override. */
  defaultTimeoutMs: number
  /** Rows visible to the model per query result (the rest stays server-side). */
  modelRowCap: number
  /** Max data points a single chart may carry. */
  chartDataCap: number
  /** Schema cache TTL in milliseconds. */
  schemaCacheTtlMs: number
  /** Directory for `/data-dashboard` files; empty = ~/Downloads/dsh-exports or tmp. */
  exportDir: string
  /** Consecutive in-memory query history entries kept per session. */
  resultCacheSize: number
  /** TTL for resultId references usable by render_chart, milliseconds. */
  resultCacheTtlMs: number
  /** Interface language: 'zh' (default) or 'en'. */
  locale: string
}

export const Config: Schema<Config> = Schema.object({
  dataSources: Schema.array(
    Schema.object({
      name: Schema.string().required().description('数据源唯一标识 | Unique datasource id, referenced by tools, e.g. demo / shop-mysql'),
      type: Schema.union(['sqlite', 'mysql', 'postgres', 'clickhouse', 'spark']).required().description('引擎类型 | Engine type'),
      file: Schema.string().description('SQLite 数据库文件绝对路径 | Absolute SQLite file path (required when type=sqlite)'),
      host: Schema.string().description('主机名 | Host; clickhouse uses an HTTP base like http://ck-prod'),
      port: Schema.number().description('端口 | Port; defaults per engine (mysql 3306 / postgres 5432 / clickhouse 8123)'),
      user: Schema.string().description('连接账号 | Account; prefer a read-only role'),
      password: Schema.string().role('secret').description('凭据建议经 !!js process.env.* 注入 | Inject via !!js process.env.*; leave blank in the card to keep the stored value'),
      database: Schema.string().description('库/schema 名 | Database/schema name (mysql/postgres/clickhouse)'),
      ssl: Schema.boolean().default(false).description('启用 TLS | Enable TLS (mysql/postgres only)'),
      approvalMode: Schema.union(['auto', 'ask']).default('auto').description('auto 直接执行;ask 每条 SQL 触发人工审批 | auto executes directly; ask requires human approval per statement'),
      maxRows: Schema.number().description('本数据源单查询行上限 | Per-source row cap; falls back to global defaultMaxRows'),
      timeoutMs: Schema.number().description('本数据源语句超时(毫秒) | Per-source statement timeout in ms; falls back to defaultTimeoutMs'),
      sparkMock: Schema.boolean().default(true).description('true 用内建 Mock(v1);接入真实后端时置 false | Use the built-in mock (v1); set false once a real backend exists'),
    }),
  ).default([]).description('已配置的数据源连接列表 | Configured datasource connections'),
  defaultDatasource: Schema.string().default('').description('默认数据源 | Default datasource; empty lets the model choose from dataSources'),
  health: Schema.dict(
    Schema.object({
      online: Schema.boolean().description('是否连通成功 | Whether the connection succeeded'),
      message: Schema.string().description('失败时的错误信息(仅离线时存在) | Error message when offline (present only when offline)'),
      at: Schema.number().description('探测完成时间戳(ms) | Probe completion timestamp in ms'),
    }),
  ).default({} as Record<string, HealthStatus>).description('各数据源连通性探测结果(在线/离线),由插件热写入 | Per-datasource connectivity probe results (online/offline), written live by the plugin'),
  testRequest: Schema.object({
    name: Schema.string().description('待探测的数据源名称 | Datasource name to probe'),
    nonce: Schema.number().description('单调请求戳,变化时触发一次探测 | Monotonic request stamp; a change triggers one probe'),
  }).description('连通性测试请求(由设置卡片写入,插件消费后探测) | Connectivity test request written by the settings card and consumed by the plugin'),
  semanticSummary: Schema.any().description('语义层预览(只读,插件热写入):状态/计数/指标列表/体检 | Semantic layer preview (read-only, written live by the plugin): state/counts/metrics/lint'),
  semanticWorkbench: Schema.any().description('工作台编辑的语义内容(实体/指标/术语),插件落盘后回写 | Semantic content authored in the workbench; the plugin persists and echoes it back'),
  scaffoldRequest: Schema.object({
    datasource: Schema.string().description('要内省并生成脚手架的数据源名称 | Datasource to introspect and scaffold from'),
    nonce: Schema.number().description('单调请求戳,变化时触发一次生成 | Monotonic request stamp; a change triggers one scaffold'),
  }).description('语义层脚手架生成请求(由设置卡片写入,插件消费) | Semantic scaffold request written by the settings card and consumed by the plugin'),
  semanticFile: Schema.string().default('').description('语义层 YAML 绝对路径 | Absolute semantic layer YAML path (entities/terms/metrics); empty disables it; hot-reloaded on save'),
  defaultMaxRows: Schema.number().default(500).description('单查询行上限 | Global row cap per query (LIMIT injection + hard truncation)'),
  defaultTimeoutMs: Schema.number().default(20_000).description('语句默认超时(毫秒) | Default statement timeout in ms'),
  modelRowCap: Schema.number().default(50).description('模型单次可见行数 | Rows visible to the model per result; the rest stays server-side behind resultId'),
  chartDataCap: Schema.number().default(500).description('单图最大数据点数 | Max data points per chart'),
  schemaCacheTtlMs: Schema.number().default(300_000).description('schema 内省缓存 TTL(毫秒) | Schema introspection cache TTL in ms'),
  exportDir: Schema.string().default('').description('/data-dashboard 输出目录 | Output directory; empty defaults to ~/Downloads/dsh-exports'),
  resultCacheSize: Schema.number().default(50).description('每会话保留的已执行查询结果条数 | Executed query results kept per session'),
  resultCacheTtlMs: Schema.number().default(30 * 60_000).description('resultId 引用 TTL(毫秒) | resultId reference TTL in ms, consumed by render_chart'),
  locale: Schema.string().default('zh').description('界面语言: zh(中文) 或 en(English)'),
})

/** Reject invalid datasource entries at load time — fail loudly, not lazily. */
export function validateConfig(config: Config): void {
  // Messages render in the configured locale: the config is already parsed
  // here, so unlike the (static) schema descriptions these can localize.
  const s = config.locale === 'en' ? en : zh
  const gte = (field: string, min: number): string => tpl(s['config.validate.gte'], { field, min: String(min) })
  const gteMs = (field: string, min: number): string => tpl(s['config.validate.gteMs'], { field, min: String(min) })

  if (config.defaultMaxRows < 1) throw new Error(`rd-data-analysis: ${gte('defaultMaxRows', 1)}`)
  if (config.defaultTimeoutMs < 100) throw new Error(`rd-data-analysis: ${gteMs('defaultTimeoutMs', 100)}`)
  if (config.modelRowCap < 1) throw new Error(`rd-data-analysis: ${gte('modelRowCap', 1)}`)
  if (config.chartDataCap < 1) throw new Error(`rd-data-analysis: ${gte('chartDataCap', 1)}`)
  if (config.schemaCacheTtlMs < 0) throw new Error(`rd-data-analysis: ${gte('schemaCacheTtlMs', 0)}`)
  if (config.resultCacheSize < 1) throw new Error(`rd-data-analysis: ${gte('resultCacheSize', 1)}`)
  if (config.resultCacheTtlMs < 0) throw new Error(`rd-data-analysis: ${gte('resultCacheTtlMs', 0)}`)

  const names = new Set<string>()
  for (const ds of config.dataSources) {
    if (names.has(ds.name)) throw new Error(`rd-data-analysis: duplicate datasource name "${ds.name}"`)
    names.add(ds.name)
    if (ds.maxRows !== undefined && ds.maxRows < 1) {
      throw new Error(`rd-data-analysis: ${tpl(s['config.validate.gte'], { field: `datasource "${ds.name}" maxRows`, min: '1' })}`)
    }
    if (ds.timeoutMs !== undefined && ds.timeoutMs < 100) {
      throw new Error(`rd-data-analysis: ${tpl(s['config.validate.gteMs'], { field: `datasource "${ds.name}" timeoutMs`, min: '100' })}`)
    }
    if (ds.type === 'sqlite' && !ds.file) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" (sqlite) requires "file"`)
    }
    if ((ds.type === 'mysql' || ds.type === 'postgres' || ds.type === 'clickhouse') && (!ds.host || !ds.database)) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" (${ds.type}) requires "host" and "database"`)
    }
  }
  if (config.defaultDatasource !== '' && !names.has(config.defaultDatasource)) {
    throw new Error(`rd-data-analysis: ${tpl(s['config.validate.defaultDatasource'], { name: config.defaultDatasource, list: [...names].join(', ') || 'none' })}`)
  }
}

/** Per-source effective limits. */
export function limitsFor(config: Config, ds: DataSourceConfig | undefined): { maxRows: number, timeoutMs: number } {
  return {
    maxRows: ds?.maxRows ?? config.defaultMaxRows,
    timeoutMs: ds?.timeoutMs ?? config.defaultTimeoutMs,
  }
}

/** Plugin identity shared by host and client halves. */
export const PLUGIN_NAME = 'rd-data-analysis'

export type PluginContext = Context
