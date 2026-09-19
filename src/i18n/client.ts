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
  | 'settings.nameRequired'
  | 'settings.fileRequired'
  | 'settings.remoteHostRequired'
  | 'settings.invalidNumberField'
  | 'settings.invalidNumberShort'
  | 'settings.fixIssuesHint'
  | 'settings.noChanges'
  | 'settings.confirmReset'
  | 'settings.confirmDelete'
  | 'settings.lastTestedAt'
  | 'settings.delete'
  | 'settings.defaultPort.mysql'
  | 'settings.defaultPort.postgres'
  | 'settings.defaultPort.clickhouse'
  | 'settings.defaultPort.spark'
  | 'settings.defaultPort.duckdb'
  | 'settings.livyUrl'
  | 'settings.livyUrlPlaceholder'
  | 'settings.livyUrlRequired'
  | 'settings.fileNoApproval'
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
  | 'settings.addFirst'
  | 'settings.unsaved'
  | 'settings.groupGovernance'
  | 'settings.moreFields'
  | 'settings.lessFields'
  | 'settings.tabConnections'
  | 'settings.tabGlobals'
  | 'settings.tabSemantic'
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
  | 'settings.semanticFileLabel'
  | 'settings.semanticPlusFiles'
  | 'settings.semanticEntities'
  | 'settings.semanticMetrics'
  | 'settings.semanticTerms'
  | 'settings.semanticIssues'
  | 'settings.semanticNoIssues'
  | 'settings.semanticLintHint'
  | 'settings.semanticEdit'
  | 'settings.semanticSource'
  | 'settings.semanticSourceHint'
  | 'settings.semanticScaffold'
  | 'settings.semanticScaffoldHint'
  | 'settings.semanticGenerating'
  | 'settings.semanticScaffoldTimeout'
  | 'settings.semanticSaveLayer'
  | 'settings.semanticResetDraft'
  | 'settings.semanticValidationMissingTable'
  | 'settings.semanticValidationUnknownTimeField'
  | 'settings.semanticValidationMissingName'
  | 'settings.semanticValidationMissingEntity'
  | 'settings.semanticValidationUnknownEntity'
  | 'settings.semanticValidationMissingMeasure'
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
  | 'settings.semanticMetricTimeField'
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
  | 'settings.semanticReady'
  | 'settings.semanticReadySummary'
  | 'settings.semanticReadyHint'
  | 'settings.semanticNeedsFix'
  | 'settings.semanticNeedsFixHint'
  | 'settings.semanticNotStarted'
  | 'settings.semanticNotStartedHint'
  | 'settings.semanticEmptyHero'
  | 'settings.semanticEmptySub'
  | 'settings.semanticStep1Title'
  | 'settings.semanticStep1Text'
  | 'settings.semanticStep2Title'
  | 'settings.semanticStep2Text'
  | 'settings.semanticStep3Title'
  | 'settings.semanticStep3Text'
  | 'settings.semanticGoGenerate'
  | 'settings.semanticClickEdit'
  | 'settings.semanticUnboundedChip'
  | 'settings.semanticFixNow'
  | 'settings.semanticFixAll'
  | 'settings.semanticAutoFillTime'
  | 'settings.semanticEntityHint'
  | 'settings.semanticMetricHint'
  | 'settings.semanticTermHint'
  | 'settings.semanticAgg.sum'
  | 'settings.semanticAgg.count'
  | 'settings.semanticAgg.avg'
  | 'settings.semanticAgg.min'
  | 'settings.semanticAgg.max'
  | 'settings.semanticAgg.count_distinct'
  | 'settings.semanticAgg.ratio'
  | 'settings.semanticAgg.expression'
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
  'settings.duplicateName': '连接名称重复:{name}',
  'settings.nameRequired': '连接名称必填',
  'settings.fileRequired': '"{name}" 需要数据库文件路径',
  'settings.remoteHostRequired': '"{name}"({type})需要 host 和 database',
  'settings.invalidNumberField': '"{name}" 的{field}需为有效数字',
  'settings.invalidNumberShort': '{field} 需为有效数字',
  'settings.fixIssuesHint': '请先修正标出的问题',
  'settings.noChanges': '暂无改动',
  'settings.confirmReset': '确认重置?',
  'settings.confirmDelete': '确认删除?',
  'settings.lastTestedAt': '上次测试 {time}',
  'settings.delete': '删除',
  'settings.defaultPort.mysql': '3306',
  'settings.defaultPort.postgres': '5432',
  'settings.defaultPort.clickhouse': '8123',
  'settings.defaultPort.spark': '',
  'settings.defaultPort.duckdb': '',
  'settings.livyUrl': 'Livy 地址',
  'settings.livyUrlPlaceholder': 'http://livy-prod:8998',
  'settings.livyUrlRequired': '"{name}"(spark)关闭 Mock 后需要 Livy 地址',
  'settings.fileNoApproval': '本地文件数据源无需审批',
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
  'settings.addFirst': '添加第一个连接',
  'settings.unsaved': '有未保存的更改',
  'settings.groupGovernance': '治理与限制',
  'settings.moreFields': '更多字段',
  'settings.lessFields': '收起字段',
  'settings.tabConnections': '数据连接',
  'settings.tabGlobals': '默认与全局',
  'settings.tabSemantic': '语义层',
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
  'settings.semanticFileLabel': '加载文件:',
  'settings.semanticPlusFiles': '(含 include 共多个文件)',
  'settings.semanticEntities': '实体',
  'settings.semanticMetrics': '指标',
  'settings.semanticTerms': '术语',
  'settings.semanticIssues': '体检告警',
  'settings.semanticNoIssues': '无告警',
  'settings.semanticLintHint': '保存即热加载;红色告警表示语义层存在口径/列名问题,需修正。',
  'settings.semanticEdit': '编辑语义层',
  'settings.semanticSource': '查看 YAML',
  'settings.semanticSourceHint': '当前草稿序列化预览;保存后热加载生效',
  'settings.semanticScaffold': '从数据源生成',
  'settings.semanticScaffoldHint': '内省选中数据源的库结构,自动生成起步的实体与指标到专属文件(不覆盖你手写的配置)。',
  'settings.semanticGenerating': '生成中…',
  'settings.semanticScaffoldTimeout': '生成未返回结果 —— 检查数据源是否可连,或查看宿主日志。',
  'settings.semanticSaveLayer': '保存语义层',
  'settings.semanticResetDraft': '撤销修改',
  'settings.semanticValidationMissingTable': '缺少表名',
  'settings.semanticValidationUnknownTimeField': '时间列不在该表的列清单里',
  'settings.semanticValidationMissingName': '缺少名称',
  'settings.semanticValidationMissingEntity': '未选择实体',
  'settings.semanticValidationUnknownEntity': '指向不存在的实体',
  'settings.semanticValidationMissingMeasure': 'count/ratio 之外需要度量列(formula/extends)之一',
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
  'settings.semanticMetricTimeField': '时间列',
  'settings.semanticMetricDimensions': '维度(逗号分隔)',
  'settings.semanticMetricFilters': '口径(每行一条)',
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
  'settings.semanticReady': '语义层就绪,AI 能正确计算指标 ✓',
  'settings.semanticReadySummary': '{e} 个业务对象 · {m} 个指标 · {t} 个术语',
  'settings.semanticReadyHint': '点击下方任意卡片可直接跳转到编辑,或继续使用"从数据源生成"补充内容。',
  'settings.semanticNeedsFix': '有 {n} 处小问题需要修正',
  'settings.semanticNeedsFixHint': '问题不阻塞使用,但修好后 AI 的答案会更准确。多数可通过"一键修复"完成。',
  'settings.semanticNotStarted': '语义层还没有内容',
  'settings.semanticNotStartedHint': '告诉 AI 你的数据长什么样,它才能用正确的口径回答你。点击"从这里开始"。',
  'settings.semanticEmptyHero': '3 步配置完成,不需要写代码',
  'settings.semanticEmptySub': '语义层 = 给 AI 一份"数据说明书"。我会帮你把数据库结构自动翻译成业务语言。',
  'settings.semanticStep1Title': '选择数据库',
  'settings.semanticStep1Text': '在下面选择要读取哪个数据库(schema)。',
  'settings.semanticStep2Title': '一键生成',
  'settings.semanticStep2Text': '自动识别表、数字字段和时间列,生成业务对象和指标。',
  'settings.semanticStep3Title': '保存生效',
  'settings.semanticStep3Text': '保存后立刻热加载。有疑问的地方,在预览里一个个点开改。',
  'settings.semanticGoGenerate': '从这里开始',
  'settings.semanticClickEdit': '点击编辑',
  'settings.semanticUnboundedChip': '缺时间列',
  'settings.semanticFixNow': '一键修复',
  'settings.semanticFixAll': '为 {n} 个指标自动补上时间列',
  'settings.semanticAutoFillTime': '自动补全时间列',
  'settings.semanticEntityHint': '业务对象 = 一个"名词",如「订单」。表名写数据库里的真实表名,业务名写人类叫法。',
  'settings.semanticMetricHint': '指标 = 一个"数字答案",如「总销售额」。聚合方式选"求和/计数",度量列选数字列。',
  'settings.semanticTermHint': '术语 = 一个"说法",如「活跃用户」。给 AI 解释这个词在你的数据里指什么。',
  'settings.semanticAgg.sum': '求和',
  'settings.semanticAgg.count': '计数',
  'settings.semanticAgg.avg': '平均',
  'settings.semanticAgg.min': '最小值',
  'settings.semanticAgg.max': '最大值',
  'settings.semanticAgg.count_distinct': '去重计数',
  'settings.semanticAgg.ratio': '比值',
  'settings.semanticAgg.expression': '自定义',
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
  'settings.duplicateName': 'Duplicate connection name: {name}',
  'settings.nameRequired': 'Connection name is required',
  'settings.fileRequired': '"{name}" requires a database file path',
  'settings.remoteHostRequired': '"{name}" ({type}) requires host and database',
  'settings.invalidNumberField': '"{name}": {field} must be a valid number',
  'settings.invalidNumberShort': '{field} must be a valid number',
  'settings.fixIssuesHint': 'Fix the highlighted issues first',
  'settings.noChanges': 'No changes yet',
  'settings.confirmReset': 'Reset edits?',
  'settings.confirmDelete': 'Delete?',
  'settings.lastTestedAt': 'Last tested {time}',
  'settings.delete': 'Delete',
  'settings.defaultPort.mysql': '3306',
  'settings.defaultPort.postgres': '5432',
  'settings.defaultPort.clickhouse': '8123',
  'settings.defaultPort.spark': '',
  'settings.defaultPort.duckdb': '',
  'settings.livyUrl': 'Livy URL',
  'settings.livyUrlPlaceholder': 'http://livy-prod:8998',
  'settings.livyUrlRequired': '"{name}" (spark) requires a Livy URL once Mock is off',
  'settings.fileNoApproval': 'Local-file datasources do not require approval',
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
  'settings.addFirst': 'Add your first connection',
  'settings.unsaved': 'Unsaved changes',
  'settings.groupGovernance': 'Governance & limits',
  'settings.moreFields': 'More fields',
  'settings.lessFields': 'Collapse fields',
  'settings.tabConnections': 'Connections',
  'settings.tabGlobals': 'Defaults & global',
  'settings.tabSemantic': 'Semantic layer',
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
  'settings.semanticFileLabel': 'Live file:',
  'settings.semanticPlusFiles': '(resolved via includes)',
  'settings.semanticEntities': 'Entities',
  'settings.semanticMetrics': 'Metrics',
  'settings.semanticTerms': 'Terms',
  'settings.semanticIssues': 'Health checks',
  'settings.semanticNoIssues': 'No issues',
  'settings.semanticLintHint': 'Hot-reloaded on save; red warnings mean the layer has definition/column problems to fix.',
  'settings.semanticEdit': 'Edit semantic layer',
  'settings.semanticSource': 'View YAML',
  'settings.semanticSourceHint': 'Live serialized preview of the current draft; hot-reloaded on save',
  'settings.semanticScaffold': 'Generate from datasource',
  'settings.semanticScaffoldHint': 'Introspect the selected datasource and scaffold starter entities/metrics into a dedicated file (your hand-written config is untouched).',
  'settings.semanticGenerating': 'Generating…',
  'settings.semanticScaffoldTimeout': 'Generation returned nothing — check the datasource connection or the host logs.',
  'settings.semanticSaveLayer': 'Save semantic layer',
  'settings.semanticResetDraft': 'Reset edits',
  'settings.semanticValidationMissingTable': 'Missing table name',
  'settings.semanticValidationUnknownTimeField': 'Time field is not in that table\'s column list',
  'settings.semanticValidationMissingName': 'Missing name',
  'settings.semanticValidationMissingEntity': 'No entity selected',
  'settings.semanticValidationUnknownEntity': 'Points to an undefined entity',
  'settings.semanticValidationMissingMeasure': 'Non-count aggs need a measure (or formula/extends)',
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
  'settings.semanticMetricTimeField': 'Time field',
  'settings.semanticMetricDimensions': 'Dimensions (comma-sep)',
  'settings.semanticMetricFilters': 'Filters (one per line)',
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
  'settings.semanticReady': 'Semantic layer ready — the assistant now computes your metrics correctly ✓',
  'settings.semanticReadySummary': '{e} entities · {m} metrics · {t} terms',
  'settings.semanticReadyHint': 'Click any card below to jump into editing, or keep adding content with "Generate from datasource".',
  'settings.semanticNeedsFix': '{n} small issue(s) need attention',
  'settings.semanticNeedsFixHint': 'Issues do not block use, but fixing them makes answers more accurate. Most are one-click fixes.',
  'settings.semanticNotStarted': 'Your semantic layer is empty',
  'settings.semanticNotStartedHint': 'Tell the assistant what your data looks like and it answers with the right definitions. Click "Get started".',
  'settings.semanticEmptyHero': 'Configure in 3 steps — no coding required',
  'settings.semanticEmptySub': 'A semantic layer is a "data manual" for the assistant. It auto-translates your database structure into business language.',
  'settings.semanticStep1Title': 'Pick a database',
  'settings.semanticStep1Text': 'Choose which database (schema) to read from below.',
  'settings.semanticStep2Title': 'Generate',
  'settings.semanticStep2Text': 'Tables, numeric fields and time columns are detected automatically into entities and metrics.',
  'settings.semanticStep3Title': 'Save',
  'settings.semanticStep3Text': 'Saving hot-reloads immediately. Open the preview and edit anything that looks off.',
  'settings.semanticGoGenerate': 'Get started',
  'settings.semanticClickEdit': 'Click to edit',
  'settings.semanticUnboundedChip': 'Missing time column',
  'settings.semanticFixNow': 'Fix now',
  'settings.semanticFixAll': 'Auto-add time column to {n} metric(s)',
  'settings.semanticAutoFillTime': 'Auto-fill time column',
  'settings.semanticEntityHint': 'An entity is a "noun" — like "Orders". Use the real table name from your database, and a human label for the business name.',
  'settings.semanticMetricHint': 'A metric is a "number answer" — like "Total sales". Pick the aggregation (sum/count) and the numeric column to measure.',
  'settings.semanticTermHint': 'A term is a phrase — like "Active users". Tell the assistant what it means in your data.',
  'settings.semanticAgg.sum': 'Sum',
  'settings.semanticAgg.count': 'Count',
  'settings.semanticAgg.avg': 'Average',
  'settings.semanticAgg.min': 'Min',
  'settings.semanticAgg.max': 'Max',
  'settings.semanticAgg.count_distinct': 'Count distinct',
  'settings.semanticAgg.ratio': 'Ratio',
  'settings.semanticAgg.expression': 'Custom',
  'chart.exportHtml': 'Export HTML',
  'chart.png': 'PNG',
  'chart.csv': 'CSV',
  'chart.copySql': 'Copy SQL',
  'chart.copied': 'Copied ✓',
  'chart.sql': 'SQL',
}
