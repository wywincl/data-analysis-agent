/**
 * Client-side i18n dictionaries for the RD Data Analysis plugin.
 *
 * @module dsh-data-analysis/i18n/client
 */

export type ClientLocale = 'zh' | 'en'

export type ClientKey =
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.unavailable'
  | 'settings.loading'
  | 'settings.addConnection'
  | 'settings.save'
  | 'settings.saving'
  | 'settings.reset'
  | 'settings.saved'
  | 'settings.emptyTitle'
  | 'settings.emptyHint'
  | 'settings.namePlaceholder'
  | 'settings.type'
  | 'settings.fileOrHost.sqlite'
  | 'settings.fileOrHost.remote'
  | 'settings.filePlaceholder'
  | 'settings.hostPlaceholder'
  | 'settings.port'
  | 'settings.database'
  | 'settings.user'
  | 'settings.password'
  | 'settings.passwordPlaceholder'
  | 'settings.approvalAsk'
  | 'settings.mock'
  | 'settings.ssl'
  | 'settings.rowLimit'
  | 'settings.timeoutMs'
  | 'settings.defaultSource'
  | 'settings.defaultSourceHint'
  | 'settings.globalDefaults'
  | 'settings.globalDefaultsHint'
  | 'settings.semantic'
  | 'settings.semanticHint'
  | 'settings.semanticPath'
  | 'settings.duplicateName'
  | 'settings.sqliteFileRequired'
  | 'settings.remoteHostRequired'
  | 'settings.delete'
  | 'settings.defaultPort.mysql'
  | 'settings.defaultPort.postgres'
  | 'settings.defaultPort.clickhouse'
  | 'settings.sqliteNoApproval'
  | 'settings.modelRowCap'
  | 'settings.chartDataCap'
  | 'settings.schemaCacheLabel'
  | 'settings.exportDirLabel'
  | 'settings.semanticPathPlaceholder'
  | 'settings.theme'
  | 'settings.themeHint'
  | 'settings.defaultSourceAuto'
  | 'settings.fallback'
  | 'settings.testConnection'
  | 'settings.testing'
  | 'settings.online'
  | 'settings.offline'
  | 'settings.notTested'
  | 'settings.semanticStatus'
  | 'settings.semanticLoaded'
  | 'settings.semanticEmpty'
  | 'settings.semanticParseError'
  | 'settings.semanticFileMissing'
  | 'settings.semanticEntities'
  | 'settings.semanticMetrics'
  | 'settings.semanticTerms'
  | 'settings.semanticIssues'
  | 'settings.semanticNoIssues'
  | 'settings.semanticLintHint'
  | 'settings.semanticEdit'
  | 'settings.semanticScaffold'
  | 'settings.semanticScaffoldHint'
  | 'settings.semanticSaveLayer'
  | 'settings.semanticAddEntity'
  | 'settings.semanticAddMetric'
  | 'settings.semanticAddTerm'
  | 'settings.semanticEntityTable'
  | 'settings.semanticEntityLabel'
  | 'settings.semanticEntityDesc'
  | 'settings.semanticEntityTimeField'
  | 'settings.semanticEntityColumns'
  | 'settings.semanticMetricName'
  | 'settings.semanticMetricLabel'
  | 'settings.semanticMetricEntity'
  | 'settings.semanticMetricAgg'
  | 'settings.semanticMetricMeasure'
  | 'settings.semanticMetricDimensions'
  | 'settings.semanticMetricFilters'
  | 'settings.semanticMetricFormula'
  | 'settings.semanticMetricGrain'
  | 'settings.semanticMetricExtends'
  | 'settings.semanticTermName'
  | 'settings.semanticTermAliases'
  | 'settings.semanticTermDesc'
  | 'settings.semanticDelete'
  | 'settings.semanticPreview'
  | 'settings.semanticDraftSaved'
  | 'settings.semanticScaffoldDone'
  | 'settings.semanticScaffoldRun'
  | 'settings.semanticNoEntities'
  | 'settings.semanticNoMetrics'
  | 'settings.semanticNoTerms'
  | 'chart.exportHtml'
  | 'chart.png'
  | 'chart.csv'
  | 'chart.copySql'
  | 'chart.copied'
  | 'chart.sql'

export const zh: Record<ClientKey, string> = {
  'settings.title': '数据库工作台',
  'settings.subtitle': '连接修改保存后<b>立即热生效</b>(无需重启);密码留空表示保持不变。语义层 YAML 保存后自动热加载,亦可用 /data-reload 手动重载。',
  'settings.unavailable': '设置服务不可用(该部署未挂载 settings),请通过配置文件(cordis patch)管理连接。',
  'settings.loading': '加载配置…',
  'settings.addConnection': '+ 添加连接',
  'settings.save': '保存(热生效)',
  'settings.saving': '保存中…',
  'settings.reset': '重置',
  'settings.saved': '已保存并热生效 ✓',
  'settings.emptyTitle': '尚未配置任何数据源。',
  'settings.emptyHint': '点击右上角「添加连接」新增;或通过配置文件(cordis patch)的 dataSources 管理。',
  'settings.namePlaceholder': '连接名称(如 demo)',
  'settings.type': '类型',
  'settings.fileOrHost.sqlite': '数据库文件',
  'settings.fileOrHost.remote': '主机 Host',
  'settings.filePlaceholder': '/path/demo.db',
  'settings.hostPlaceholder': 'host 或 http://host',
  'settings.port': '端口',
  'settings.database': '数据库',
  'settings.user': '用户',
  'settings.password': '密码',
  'settings.passwordPlaceholder': '留空不变',
  'settings.approvalAsk': '写入前人工审批(ask)',
  'settings.mock': '使用内建 Mock 数据',
  'settings.ssl': '启用 TLS(SSL)',
  'settings.rowLimit': '行上限',
  'settings.timeoutMs': '超时(ms)',
  'settings.defaultSource': '默认数据源',
  'settings.defaultSourceHint': '用户提问未指明具体来源时,模型优先使用该数据源;选择「自动」则让模型自行判断。',
  'settings.globalDefaults': '全局默认',
  'settings.globalDefaultsHint': '留空使用内置默认;单连接字段覆盖这里的值。',
  'settings.semantic': '语义层',
  'settings.semanticHint': '实体 / 术语 / 指标定义 YAML;保存后自动热加载,亦可用 /data-reload 手动重载。',
  'settings.semanticPath': '配置文件路径',
  'settings.duplicateName': '连接名称重复',
  'settings.sqliteFileRequired': '"${name}"(sqlite)需要 file 路径',
  'settings.remoteHostRequired': '"${name}"(${type})需要 host 和 database',
  'settings.delete': '删除',
  'settings.defaultPort.mysql': '3306',
  'settings.defaultPort.postgres': '5432',
  'settings.defaultPort.clickhouse': '8123',
  'settings.sqliteNoApproval': 'SQLite 无需审批',
  'settings.modelRowCap': '模型可见行数',
  'settings.chartDataCap': '单图数据点',
  'settings.schemaCacheLabel': 'schema 缓存 TTL(ms)',
  'settings.exportDirLabel': '仪表板导出目录',
  'settings.semanticPathPlaceholder': '语义层 YAML 绝对路径(可选)',
  'settings.theme': '外观主题',
  'settings.themeHint': '自动跟随系统 light/dark 模式,无需手动配置。',
  'settings.defaultSourceAuto': '自动(由模型选择)',
  'settings.fallback': '缺省',
  'settings.testConnection': '测试连接',
  'settings.testing': '测试中…',
  'settings.online': '在线',
  'settings.offline': '离线',
  'settings.notTested': '未测试',
  'settings.semanticStatus': '状态',
  'settings.semanticLoaded': '已加载',
  'settings.semanticEmpty': '未配置',
  'settings.semanticParseError': '解析失败',
  'settings.semanticFileMissing': '文件缺失',
  'settings.semanticEntities': '实体',
  'settings.semanticMetrics': '指标',
  'settings.semanticTerms': '术语',
  'settings.semanticIssues': '体检告警',
  'settings.semanticNoIssues': '无告警',
  'settings.semanticLintHint': '保存即热加载;红色告警表示语义层存在口径/列名问题,需修正。',
  'settings.semanticEdit': '编辑语义层',
  'settings.semanticScaffold': '从数据源生成',
  'settings.semanticScaffoldHint': '内省选中数据源的库结构,自动生成起步的实体与指标到专属文件(不覆盖你手写的配置)。',
  'settings.semanticSaveLayer': '保存语义层',
  'settings.semanticAddEntity': '+ 实体',
  'settings.semanticAddMetric': '+ 指标',
  'settings.semanticAddTerm': '+ 术语',
  'settings.semanticEntityTable': '表名',
  'settings.semanticEntityLabel': '业务名',
  'settings.semanticEntityDesc': '描述',
  'settings.semanticEntityTimeField': '时间列',
  'settings.semanticEntityColumns': '列(每行 name 或 name: 标签)',
  'settings.semanticMetricName': '指标名',
  'settings.semanticMetricLabel': '业务名',
  'settings.semanticMetricEntity': '实体',
  'settings.semanticMetricAgg': '聚合',
  'settings.semanticMetricMeasure': '度量列',
  'settings.semanticMetricDimensions': '维度(逗号分隔)',
  'settings.semanticMetricFilters': '口径(逗号分隔,每行一条)',
  'settings.semanticMetricFormula': '口径公式(说明)',
  'settings.semanticMetricGrain': '粒度',
  'settings.semanticMetricExtends': '继承自',
  'settings.semanticTermName': '术语',
  'settings.semanticTermAliases': '别名(逗号分隔)',
  'settings.semanticTermDesc': '描述',
  'settings.semanticDelete': '删除',
  'settings.semanticPreview': '预览',
  'settings.semanticDraftSaved': '语义层已保存并热加载 ✓',
  'settings.semanticScaffoldDone': '已从数据源生成起步语义层 ✓',
  'settings.semanticScaffoldRun': '生成',
  'settings.semanticNoEntities': '暂无实体，点击"+ 实体"添加或使用"从数据源生成"',
  'settings.semanticNoMetrics': '暂无指标，点击"+ 指标"添加或使用"从数据源生成"',
  'settings.semanticNoTerms': '暂无术语，点击"+ 术语"添加',
  'chart.exportHtml': '导出 HTML',
  'chart.png': 'PNG',
  'chart.csv': 'CSV',
  'chart.copySql': '复制 SQL',
  'chart.copied': '已复制 ✓',
  'chart.sql': 'SQL',
}

export const en: Record<ClientKey, string> = {
  'settings.title': 'Database Workbench',
  'settings.subtitle': 'Connection changes take effect <b>immediately</b> (no restart needed); leave password blank to keep current. Semantic layer YAML auto hot-reloads on save; use /data-reload for manual reload.',
  'settings.unavailable': 'Settings service unavailable (this deployment does not mount settings). Manage connections via config file (cordis patch).',
  'settings.loading': 'Loading config…',
  'settings.addConnection': '+ Add connection',
  'settings.save': 'Save (hot apply)',
  'settings.saving': 'Saving…',
  'settings.reset': 'Reset',
  'settings.saved': 'Saved and hot-applied ✓',
  'settings.emptyTitle': 'No data sources configured yet.',
  'settings.emptyHint': 'Click "Add connection" in the top-right to add one; or manage via config file (cordis patch) dataSources.',
  'settings.namePlaceholder': 'Connection name (e.g. demo)',
  'settings.type': 'Type',
  'settings.fileOrHost.sqlite': 'Database file',
  'settings.fileOrHost.remote': 'Host',
  'settings.filePlaceholder': '/path/demo.db',
  'settings.hostPlaceholder': 'host or http://host',
  'settings.port': 'Port',
  'settings.database': 'Database',
  'settings.user': 'User',
  'settings.password': 'Password',
  'settings.passwordPlaceholder': 'Blank to keep current',
  'settings.approvalAsk': 'Require approval before writes (ask)',
  'settings.mock': 'Use built-in Mock data',
  'settings.ssl': 'Enable TLS (SSL)',
  'settings.rowLimit': 'Row limit',
  'settings.timeoutMs': 'Timeout (ms)',
  'settings.defaultSource': 'Default datasource',
  'settings.defaultSourceHint': 'When the user does not name a source, the model prefers this one; select "Auto" to let the model decide.',
  'settings.globalDefaults': 'Global defaults',
  'settings.globalDefaultsHint': 'Leave blank to use built-in defaults; per-connection fields override these values.',
  'settings.semantic': 'Semantic layer',
  'settings.semanticHint': 'Entity / term / metric YAML definitions; auto hot-reloads on save; use /data-reload to reload manually.',
  'settings.semanticPath': 'Config file path',
  'settings.duplicateName': 'Duplicate connection name',
  'settings.sqliteFileRequired': '"${name}" (sqlite) requires a file path',
  'settings.remoteHostRequired': '"${name}" (${type}) requires host and database',
  'settings.delete': 'Delete',
  'settings.defaultPort.mysql': '3306',
  'settings.defaultPort.postgres': '5432',
  'settings.defaultPort.clickhouse': '8123',
  'settings.sqliteNoApproval': 'SQLite does not require approval',
  'settings.modelRowCap': 'Model visible rows',
  'settings.chartDataCap': 'Chart data points',
  'settings.schemaCacheLabel': 'Schema cache TTL (ms)',
  'settings.exportDirLabel': 'Dashboard export dir',
  'settings.semanticPathPlaceholder': 'Semantic layer YAML path (optional)',
  'settings.theme': 'Appearance',
  'settings.themeHint': 'Automatically follows the system light/dark mode; no manual configuration needed.',
  'settings.defaultSourceAuto': 'Automatic (model picks)',
  'settings.fallback': 'default',
  'settings.testConnection': 'Test connection',
  'settings.testing': 'Testing…',
  'settings.online': 'Online',
  'settings.offline': 'Offline',
  'settings.notTested': 'Not tested',
  'settings.semanticStatus': 'Status',
  'settings.semanticLoaded': 'Loaded',
  'settings.semanticEmpty': 'Not configured',
  'settings.semanticParseError': 'Parse error',
  'settings.semanticFileMissing': 'File missing',
  'settings.semanticEntities': 'Entities',
  'settings.semanticMetrics': 'Metrics',
  'settings.semanticTerms': 'Terms',
  'settings.semanticIssues': 'Health checks',
  'settings.semanticNoIssues': 'No issues',
  'settings.semanticLintHint': 'Hot-reloaded on save; red warnings mean the layer has口径/column problems to fix.',
  'settings.semanticEdit': 'Edit semantic layer',
  'settings.semanticScaffold': 'Generate from datasource',
  'settings.semanticScaffoldHint': 'Introspect the selected datasource and scaffold starter entities/metrics into a dedicated file (your hand-written config is untouched).',
  'settings.semanticSaveLayer': 'Save semantic layer',
  'settings.semanticAddEntity': '+ Entity',
  'settings.semanticAddMetric': '+ Metric',
  'settings.semanticAddTerm': '+ Term',
  'settings.semanticEntityTable': 'Table',
  'settings.semanticEntityLabel': 'Label',
  'settings.semanticEntityDesc': 'Description',
  'settings.semanticEntityTimeField': 'Time column',
  'settings.semanticEntityColumns': 'Columns (one per line: name or name: label)',
  'settings.semanticMetricName': 'Metric',
  'settings.semanticMetricLabel': 'Label',
  'settings.semanticMetricEntity': 'Entity',
  'settings.semanticMetricAgg': 'Agg',
  'settings.semanticMetricMeasure': 'Measure',
  'settings.semanticMetricDimensions': 'Dimensions (comma-sep)',
  'settings.semanticMetricFilters': '口径 Filters (comma-sep, one per line)',
  'settings.semanticMetricFormula': 'Formula (note)',
  'settings.semanticMetricGrain': 'Grain',
  'settings.semanticMetricExtends': 'Extends',
  'settings.semanticTermName': 'Term',
  'settings.semanticTermAliases': 'Aliases (comma-sep)',
  'settings.semanticTermDesc': 'Description',
  'settings.semanticDelete': 'Delete',
  'settings.semanticPreview': 'Preview',
  'settings.semanticDraftSaved': 'Semantic layer saved and hot-reloaded ✓',
  'settings.semanticScaffoldDone': 'Scaffolded starter semantic layer from datasource ✓',
  'settings.semanticScaffoldRun': 'Generate',
  'settings.semanticNoEntities': 'No entities yet. Click "+ Entity" or use "Generate from datasource"',
  'settings.semanticNoMetrics': 'No metrics yet. Click "+ Metric" or use "Generate from datasource"',
  'settings.semanticNoTerms': 'No terms yet. Click "+ Term" to add',
  'chart.exportHtml': 'Export HTML',
  'chart.png': 'PNG',
  'chart.csv': 'CSV',
  'chart.copySql': 'Copy SQL',
  'chart.copied': 'Copied ✓',
  'chart.sql': 'SQL',
}
