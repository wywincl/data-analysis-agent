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
}

export const Config: Schema<Config> = Schema.object({
  dataSources: Schema.array(
    Schema.object({
      name: Schema.string().required().description('数据源唯一标识,工具中作为引用键,如 demo / shop-mysql'),
      type: Schema.union(['sqlite', 'mysql', 'postgres', 'clickhouse', 'spark']).required().description('引擎类型'),
      file: Schema.string().description('SQLite 数据库文件绝对路径(type=sqlite 时必填)'),
      host: Schema.string().description('mysql/postgres:主机名;clickhouse:HTTP base(如 http://ck-prod)'),
      port: Schema.number().description('端口,缺省用引擎默认(mysql 3306 / postgres 5432 / clickhouse 8123)'),
      user: Schema.string().description('连接账号,建议只读角色'),
      password: Schema.string().role('secret').description('凭据建议经 !!js process.env.* 注入,卡片中留空保持不变'),
      database: Schema.string().description('库/schema 名(mysql/postgres/clickhouse)'),
      ssl: Schema.boolean().default(false).description('启用 TLS(仅 mysql/postgres)'),
      approvalMode: Schema.union(['auto', 'ask']).default('auto').description('auto 直接执行;ask 每条 SQL 触发人工审批'),
      maxRows: Schema.number().description('本数据源单查询行上限,缺省用全局 defaultMaxRows'),
      timeoutMs: Schema.number().description('本数据源语句超时(毫秒),缺省用全局 defaultTimeoutMs'),
      sparkMock: Schema.boolean().default(true).description('true 用内建 Mock(v1);接入真实后端时置 false'),
    }),
  ).default([]).description('已配置的数据源连接列表'),
  defaultDatasource: Schema.string().default('').description('默认数据源:用户未指明时模型优先使用;空则让模型从 dataSources 自行选择'),
  semanticFile: Schema.string().default('').description('语义层 YAML 绝对路径(entities/terms/metrics);空则禁用。保存后自动热加载'),
  defaultMaxRows: Schema.number().default(500).description('单查询行上限(注入 LIMIT + 硬截断)'),
  defaultTimeoutMs: Schema.number().default(20_000).description('语句默认超时(毫秒)'),
  modelRowCap: Schema.number().default(50).description('模型单次可见行数,其余经 resultId 引用留在服务端'),
  chartDataCap: Schema.number().default(500).description('单图最大数据点数'),
  schemaCacheTtlMs: Schema.number().default(300_000).description('schema 内省缓存 TTL(毫秒)'),
  exportDir: Schema.string().default('').description('/data-dashboard 输出目录;空则默认 ~/Downloads/dsh-exports'),
  resultCacheSize: Schema.number().default(50).description('每会话保留的已执行查询结果条数'),
  resultCacheTtlMs: Schema.number().default(30 * 60_000).description('resultId 引用 TTL(毫秒),供 render_chart 复用'),
})

/** Reject invalid datasource entries at load time — fail loudly, not lazily. */
export function validateConfig(config: Config): void {
  if (config.defaultMaxRows < 1) throw new Error('rd-data-analysis: defaultMaxRows 必须 >= 1')
  if (config.defaultTimeoutMs < 100) throw new Error('rd-data-analysis: defaultTimeoutMs 必须 >= 100ms')
  if (config.modelRowCap < 1) throw new Error('rd-data-analysis: modelRowCap 必须 >= 1')
  if (config.chartDataCap < 1) throw new Error('rd-data-analysis: chartDataCap 必须 >= 1')
  if (config.schemaCacheTtlMs < 0) throw new Error('rd-data-analysis: schemaCacheTtlMs 必须 >= 0')
  if (config.resultCacheSize < 1) throw new Error('rd-data-analysis: resultCacheSize 必须 >= 1')
  if (config.resultCacheTtlMs < 0) throw new Error('rd-data-analysis: resultCacheTtlMs 必须 >= 0')

  const names = new Set<string>()
  for (const ds of config.dataSources) {
    if (names.has(ds.name)) throw new Error(`rd-data-analysis: duplicate datasource name "${ds.name}"`)
    names.add(ds.name)
    if (ds.maxRows !== undefined && ds.maxRows < 1) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" maxRows 必须 >= 1`)
    }
    if (ds.timeoutMs !== undefined && ds.timeoutMs < 100) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" timeoutMs 必须 >= 100ms`)
    }
    if (ds.type === 'sqlite' && !ds.file) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" (sqlite) requires "file"`)
    }
    if ((ds.type === 'mysql' || ds.type === 'postgres' || ds.type === 'clickhouse') && (!ds.host || !ds.database)) {
      throw new Error(`rd-data-analysis: datasource "${ds.name}" (${ds.type}) requires "host" and "database"`)
    }
  }
  if (config.defaultDatasource !== '' && !names.has(config.defaultDatasource)) {
    throw new Error(`rd-data-analysis: defaultDatasource "${config.defaultDatasource}" 未匹配任何已配置的数据源(dataSources: ${[...names].join(', ') || 'none'})`)
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
