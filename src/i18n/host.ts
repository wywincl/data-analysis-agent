/**
 * Host-side i18n strings for prompts, commands, and tools.
 *
 * @module dsh-rd-data-analysis/i18n/host
 */

export type HostLocale = 'zh' | 'en'

export interface HostStrings {
  'workflow.title': string
  'workflow.connectedTo': string
  'workflow.discipline': string
  'workflow.step1': string
  'workflow.step2': string
  'workflow.step3': string
  'workflow.step4': string
  'workflow.step5': string
  'workflow.step6': string
  'workflow.qualityRules': string
  'semantic.sectionTitle': string
  'semantic.digestPrefix': string
  'cmd.data-sources.desc': string
  'cmd.data-sources.noConfig': string
  'cmd.data-sources.result': string
  'cmd.data-test.desc': string
  'cmd.data-test.usage': string
  'cmd.data-test.unknown': string
  'cmd.data-test.success': string
  'cmd.data-test.fail': string
  'cmd.data-reload.desc': string
  'cmd.data-reload.noFile': string
  'cmd.data-reload.fail': string
  'cmd.data-reload.success': string
  'cmd.data-reload.includeNote': string
  'cmd.data-reload.lintWarn': string
  'cmd.data-reload.lintClean': string
  'cmd.data-semantic-lint.desc': string
  'cmd.data-semantic-lint.noFile': string
  'cmd.data-semantic-lint.header': string
  'cmd.data-semantic-lint.fail': string
  'cmd.data-semantic-lint.pass': string
  'cmd.data-semantic-lint.warnings': string
  'cmd.data-schema.desc': string
  'cmd.data-schema.usage': string
  'cmd.data-schema.notFound': string
  'cmd.data-schema.result': string
  'cmd.data-sql.desc': string
  'cmd.data-sql.usage': string
  'cmd.data-sql.unknown': string
  'cmd.data-sql.success': string
  'cmd.data-dashboard.desc': string
  'cmd.data-dashboard.noCharts': string
  'cmd.data-dashboard.success': string
  'cmd.data-csv.desc': string
  'cmd.data-csv.noResults': string
  'cmd.data-csv.success': string
  'tool.list_data_sources.desc': string
  'tool.inspect_schema.desc': string
  'tool.inspect_schema.ok': string
  'tool.inspect_schema.samples': string
  'tool.run_sql.desc': string
  'tool.run_sql.ok': string
  'tool.run_sql.truncatedNote': string
  'tool.run_sql.resultIdHint': string
  'tool.render_chart.desc': string
  'tool.render_chart.rendered': string
  'tool.analyze_data.desc': string
  'tool.analyze_data.complete': string
  'tool.list_semantic.desc': string
  'tool.list_semantic.error': string
  'tool.list_semantic.noFile': string
  'tool.list_semantic.lintWarn': string
  'tool.list_semantic.metricsHeader': string
  'tool.list_semantic.termsHeader': string
  'tool.list_semantic.entitiesHeader': string
  'tool.list_semantic.filesHeader': string
  'tool.list_semantic.empty': string
  'tool.list_semantic.formula': string
  'tool.list_semantic.filters': string
  'tool.query_metric.desc': string
  'tool.query_metric.cardPrefix': string
  'tool.query_metric.render.success': string
  'tool.query_metric.missingDatasource': string
  // Semantic-layer lint: one message + one optional hint per rule code.
  // Issues carry structured params; these templates are applied at render
  // time so switching locale needs no semantic reload.
  'lint.duplicate-definition.message': string
  'lint.duplicate-definition.hint': string
  'lint.unknown-dimension-column.message': string
  'lint.unknown-dimension-column.hint': string
  'lint.unknown-measure-column.message': string
  'lint.unknown-measure-column.hint': string
  'lint.unknown-timefield-column.message': string
  'lint.unknown-timefield-column.hint': string
  'lint.duplicate-dimension.message': string
  'lint.duplicate-dimension.hint': string
  'lint.count-with-measure.message': string
  'lint.count-with-measure.hint': string
  'lint.term-alias-collision.message': string
  'lint.term-alias-collision.hint': string
  'lint.metric-shadows-term.message': string
  'lint.metric-shadows-term.hint': string
  'lint.unbounded-metric.message': string
  'lint.unbounded-metric.hint': string
  'lint.missing-label.message': string
  'lint.missing-label.hint': string
  'tool.render_chart.cardPrefix': string
  'tool.analyze_data.cardPrefix': string
  'config.validate.gte': string
  'config.validate.gteMs': string
  'config.validate.defaultDatasource': string
  'export.html.byline': string
  'export.html.footer': string
}

export const zh: HostStrings = {
  'workflow.title': '## 数据分析工作流',
  'workflow.connectedTo': '你通过 rd-data-analysis 插件连接到以下数据源:\n{sources}{defaultNote}',
  'workflow.discipline': '对每个数据问题遵循以下纪律:',
  'workflow.step1': '不确定有什么数据源时，先调用 **list_data_sources** 一次。',
  'workflow.step2': '写 SQL 之前必须先 **inspect_schema**。永远不要猜测表名或列名。',
  'workflow.step3': '使用 **run_sql** 执行一条只读 SELECT。护栏是不可协商的，由平台强制执行：单条 SELECT/WITH 语句、无 DML/DDL、缺失时自动注入 LIMIT、每数据源行数上限和超时。始终填写 `reason`（用途说明，展示给审批人并写入审计）。',
  'workflow.step4': '只要结果有形状，就调用 **render_chart** 生成图表：趋势 → line，对比 → bar，占比 → pie，关系 → scatter，密度 → heatmap，单一 headline 数字 → kpi。优先传递 run_sql 返回的 `resultId` 而非重新发送行。图表会内嵌在对话中，支持 HTML/PNG/CSV 导出。',
  'workflow.step5': '统计需求使用 **analyze_data**：profile / topn / correlation / distribution——不要手动写重复 SQL。在回答中解释返回的数字。',
  'workflow.step6': '用你实际查询到的数字作答，引用你运行的 SQL，并标注截断（行数上限）或 mock 数据源。如果查询被护栏拒绝，将其重写为单条 SELECT——不要试图绕过护栏。',
  'workflow.qualityRules': 'Text2SQL 质量规则：在 SQL 中过滤（而非事后处理），尽可能在 SQL 中聚合，优先使用显式列列表而非 *，并使用目标数据源的方言（参考 inspect_schema 输出）。',
  'semantic.sectionTitle': '## 语义层 (语义层)',
  'semantic.digestPrefix': '当问题匹配受治理指标时，调用 query_metric——永远不要手动重建其 SQL。如果用户要求治理新指标/标签，建议编辑语义文件（{semanticFileHint}）并热加载。',
  'cmd.data-sources.desc': '列出已配置的数据源及其状态',
  'cmd.data-sources.noConfig': '未配置任何数据源。请在数据源列表或插件配置(dataSources)中添加。',
  'cmd.data-sources.result': '数据源 ({count}):\n{sources}',
  'cmd.data-test.desc': '测试单个数据源连接（内省往返）',
  'cmd.data-test.usage': '用法: /data-test <datasource>',
  'cmd.data-test.unknown': '未知数据源 "{0}"。请尝试 /data-sources。',
  'cmd.data-test.success': '✓ {name} ({type}) 在 {elapsed}ms 内连接成功 — {tables} 个表/视图。',
  'cmd.data-test.fail': '✗ {name} ({type}) 连接失败: {err}',
  'cmd.data-reload.desc': '重新加载语义层文件（保存时也会自动热加载）',
  'cmd.data-reload.noFile': '未配置语义层文件 — 在工作台卡片或配置中设置 semanticFile。',
  'cmd.data-reload.fail': '语义层重新加载失败（保留上一次有效配置）:\n{err}',
  'cmd.data-reload.success': '✓ 语义层已从 {file} 重新加载{files}: {metrics} 个指标, {entities} 个实体, {terms} 个术语。{lint}',
  'cmd.data-reload.includeNote': ' (含 {count} 个 include 文件)',
  'cmd.data-reload.lintWarn': '\n⚠️ {count} 条体检提示 — 用 /data-semantic-lint 查看详情',
  'cmd.data-reload.lintClean': '\n✓ 语义层体检无提示',
  'cmd.data-semantic-lint.desc': '语义层配置健康检查（未阻塞的问题）',
  'cmd.data-semantic-lint.noFile': '未配置语义层文件 — 在工作台卡片或配置中设置 semanticFile。',
  'cmd.data-semantic-lint.header': '{files} 个文件 include 自根文件 · {metrics} metrics / {entities} entities / {terms} terms',
  'cmd.data-semantic-lint.fail': '语义层加载失败（当前沿用上一次有效配置）:\n{err}\n{header}',
  'cmd.data-semantic-lint.pass': '✓ 语义层体检通过\n{header}',
  'cmd.data-semantic-lint.warnings': '⚠️ 语义层体检 {count} 条提示（不阻塞查询）\n{header}\n\n{lines}',
  'cmd.data-schema.desc': '显示数据源的表/列',
  'cmd.data-schema.usage': '用法: /data-schema <datasource> [table]',
  'cmd.data-schema.notFound': '在 "{ds}" 中未找到表 "{table}"。',
  'cmd.data-schema.result': '{ds}: {count} 个表\n{lines}{note}',
  'cmd.data-sql.desc': '直接运行一条只读 SELECT（结果不进入模型历史）',
  'cmd.data-sql.usage': '用法: /data-sql <datasource> <select 语句>',
  'cmd.data-sql.unknown': '未知数据源 "{0}"。请尝试 /data-sources。',
  'cmd.data-sql.success': 'OK — {count} 行{note}\n{table}',
  'cmd.data-dashboard.desc': '将会话中的所有图表导出为一个自包含 HTML 仪表板',
  'cmd.data-dashboard.noCharts': '此会话中暂无图表可导出 — 请先让代理渲染图表。',
  'cmd.data-dashboard.success': '仪表板已导出: {file}\n{count} 个图表，自包含（可离线工作）。提示: 对话中的每个图表节点也有单图 HTML/PNG/CSV 导出按钮。',
  'cmd.data-csv.desc': '将最新的查询结果导出为 CSV',
  'cmd.data-csv.noResults': '此会话中暂无缓存的结果。',
  'cmd.data-csv.success': 'CSV 已导出: {file} ({count} 行)',
  'tool.list_data_sources.desc': '列出已配置的数据源（SQLite / MySQL / PostgreSQL / Spark），包含引擎、方言和审批模式。不确定有什么数据源时先调用此工具。',
  'tool.inspect_schema.desc': "检查数据源的 schema：表/视图、列类型和注释、行数估算、可选样本行。写 SQL 之前必须先读取。Schema 有短暂缓存；怀疑有 DDL 变更时传递 refresh 重新内省。",
  'tool.inspect_schema.ok': '"{ds}" 的 schema — {count} 个表{truncated}:',
  'tool.inspect_schema.samples': '样本',
  'tool.run_sql.desc': '对数据源执行一条只读 SELECT（text2SQL：你写 SQL）。护栏：仅单条 SELECT/WITH 语句，缺失时自动注入 LIMIT，每数据源行数上限和超时强制执行。返回 resultId 可传递给 render_chart 而无需重新发送行。始终先 inspect_schema；在 "reason" 中说明意图（展示给审批人并写入审计）。',
  'tool.run_sql.ok': '查询成功 "{ds}" — {count} 行，列: {columns}。',
  'tool.run_sql.truncatedNote': '\n注意：结果达到行数上限 — 可能还有更多行。在 SQL 中聚合或细化过滤条件来获取总数，而不是翻页。',
  'tool.run_sql.resultIdHint': 'resultId: {rid}  ← 将此值传递给 render_chart 来图表化完整结果',
  'tool.render_chart.desc': '在聊天中渲染交互式 ECharts 可视化，并支持 HTML/PNG/CSV 导出。三个数据源，优先级：(1) 上次 run_sql 的 resultId — 即使只给你预览也能图表化完整结果；(2) sql — 在相同护栏下新鲜执行一条 SELECT；(3) 内联数据行。图表 option JSON 由平台构建 — 你只需声明意图：chartType、字段、标题。chartType 优先用 "auto"：平台依据结果形态（基数、是否时间列、数值列数量）自动选用最合适的图型；看数值分布用 boxplot（按类别计算四分位），看阶段转化用 funnel。',
  'tool.render_chart.rendered': '图表已在对话中渲染（chartId {cid}，{points} 个数据点）。用户看到带 HTML/PNG/CSV 导出按钮的交互式图表。',
  'tool.analyze_data.desc': '对基础 SELECT 运行内置统计分析：profile（每列统计）、topn（分组 Top-N）、correlation（两数值列 Pearson 相关）、distribution（直方图）、insight（综合洞察：总量/均值/中位数/标准差、趋势方向与环比、Top 贡献者占比、帕累托集中度、z-score 异常值；可选 dimension、metric、topN）。传入基础 SQL；派生查询自动生成并执行。',
  'tool.analyze_data.complete': '分析 "{analysis}" 完成 — 请解释以下数字并给出证据:',
  'tool.list_semantic.desc': '列出语义层目录：受治理指标及其口径（公式/grain/维度/单位）、业务术语、表/列业务标签。当问题匹配时优先使用这些受治理指标而非手写 SQL。传递指标名称给 query_metric。',
  'tool.list_semantic.error': '语义层加载错误(沿用上一次有效配置)',
  'tool.list_semantic.noFile': '(未配置语义层文件 — 在工作台卡片或配置里设置 semanticFile 启用)',
  'tool.list_semantic.lintWarn': '语义层体检 {count} 条提示(不影响查询,建议下次改配置时顺手修掉):',
  'tool.list_semantic.metricsHeader': 'Governed metrics 指标目录:',
  'tool.list_semantic.termsHeader': 'Business terms 业务术语:',
  'tool.list_semantic.entitiesHeader': 'Entities 业务表:',
  'tool.list_semantic.filesHeader': '组成文件 {count} 个(include 展开顺序,后者覆盖前者):',
  'tool.list_semantic.empty': '语义层为空。',
  'tool.list_semantic.formula': '口径',
  'tool.list_semantic.filters': '固定过滤',
  'tool.query_metric.desc': '从语义层查询受治理指标（统一口径，审计安全）。根据指标定义构建 SQL — 你只需选择指标 id、可选的已声明维度、维度值过滤器和可选的 from/to 时间范围。返回行和 render_chart 可用的 resultId。当 list_semantic 指标匹配问题时优先使用此工具而非 run_sql。',
  'tool.query_metric.cardPrefix': '指标查询',
  'tool.query_metric.render.success': '指标 "{metric}" 在 "{ds}" 上查询成功 — {count} 行。{note}\nresultId: {rid}  ← 将此值传递给 render_chart\nSQL（从受治理定义生成）:\n{sql}\n\n{table}',
  'tool.query_metric.missingDatasource': '指标 "{metric}" 解析到数据源 "{ds}" 但未配置。修复语义层或添加连接。',
  'lint.duplicate-definition.message': '重复定义,已采用 {winner} 的版本,{loser} 中的同名定义被丢弃',
  'lint.duplicate-definition.hint': '若是有意覆盖,可忽略;否则改用 extends 继承,或只覆盖需要变更的字段',
  'lint.unknown-dimension-column.message': '维度 {names} 未在 entity "{entity}".columns 中声明',
  'lint.unknown-dimension-column.hint': '补齐 entity 的 columns 定义,或修正维度名;查询时该维度会拼进 GROUP BY,列不存在会直接报错',
  'lint.unknown-measure-column.message': '度量列 "{column}" 未在 entity "{entity}".columns 中声明',
  'lint.unknown-measure-column.hint': '补齐 entity 的 columns 定义,或修正 measure',
  'lint.unknown-timefield-column.message': '时间列 "{column}" 未在 entity "{entity}".columns 中声明',
  'lint.unknown-timefield-column.hint': 'from/to 时间范围会作用在这一列上',
  'lint.duplicate-dimension.message': '维度 {names} 重复声明',
  'lint.duplicate-dimension.hint': '重复的维度会在 GROUP BY 里出现两次',
  'lint.count-with-measure.message': 'agg 为 count 时 measure "{measure}" 会被忽略(生成的是 COUNT(*))',
  'lint.count-with-measure.hint': '如需去重计数请改用 agg: count_distinct',
  'lint.term-alias-collision.message': '术语 "{term}" 的名称/别名 "{name}" 与术语 "{owner}" 冲突',
  'lint.term-alias-collision.hint': '同名口径会让模型选错术语,请合并或改用不同别名',
  'lint.metric-shadows-term.message': '指标名 "{metric}" 与术语 "{term}" 同名',
  'lint.metric-shadows-term.hint': '指标目录和术语表会同时注入提示词,同名会造成歧义',
  'lint.unbounded-metric.message': '既没有 timeField 也没有固定 filters,查询将全表聚合',
  'lint.unbounded-metric.hint': '补上 timeField 以支持时间范围,或在 filters 里限定口径',
  'lint.missing-label.message': '{count} 个指标缺少 label,模型只能看到 id: {names}',
  'lint.missing-label.hint': 'label 是指标在目录和提示词里的中文名,建议补齐',
  'tool.render_chart.cardPrefix': '图表',
  'tool.analyze_data.cardPrefix': '分析',
  'config.validate.gte': '{field} 必须 >= {min}',
  'config.validate.gteMs': '{field} 必须 >= {min}ms',
  'config.validate.defaultDatasource': 'defaultDatasource "{name}" 未匹配任何已配置的数据源(dataSources: {list})',
  'export.html.byline': '由 RD Data Analysis Agent 导出 · {time} · {count} 个图表 · 离线可交互',
  'export.html.footer': '数据来源见各图「SQL」折叠区。本文件为自包含交互式页面，可直接在浏览器打开。',
}

export const en: HostStrings = {
  'workflow.title': '## Data analysis workflow',
  'workflow.connectedTo': 'You are connected to these data sources through the rd-data-analysis plugin:\n{sources}{defaultNote}',
  'workflow.discipline': 'Follow this discipline for every data question:',
  'workflow.step1': 'Call **list_data_sources** once when unsure what exists.',
  'workflow.step2': '**inspect_schema** before writing SQL. Never guess table or column names.',
  'workflow.step3': 'Use **run_sql** with ONE read-only SELECT. Guardrails are non-negotiable and enforced for you: single SELECT/WITH statement, no DML/DDL, LIMIT auto-injected when missing, per-source row cap and timeout. Always fill `reason` with the question the query answers (shown to approvers).',
  'workflow.step4': 'Call **render_chart** whenever a result has shape: trend → line, comparison → bar, share → pie, relationship → scatter, density → heatmap, single headline number → kpi. Prefer passing the `resultId` from run_sql over re-sending rows. Charts render inside the conversation with HTML/PNG/CSV export.',
  'workflow.step5': 'Use **analyze_data** for statistics: profile / topn / correlation / distribution — instead of hand-rolling the same SQL. Interpret the returned numbers in your answer.',
  'workflow.step6': 'Answer with the numbers you actually queried, cite the SQL you ran, and flag truncation (row caps) or mock datasources explicitly. If a query fails the guard, rewrite it as a single SELECT — do not attempt to bypass the guardrails.',
  'workflow.qualityRules': 'Text2SQL quality rules: filter in SQL (not post-hoc), aggregate in SQL when possible, prefer explicit column lists over *, and use the dialect of the target source (see inspect_schema output).',
  'semantic.sectionTitle': '## Semantic layer',
  'semantic.digestPrefix': 'When a governed metric matches the question, call query_metric — never rebuild its SQL by hand. If the user asks to govern new metrics/labels, propose edits to the semantic file ({semanticFileHint}) and they hot-reload.',
  'cmd.data-sources.desc': 'List configured data sources and their status',
  'cmd.data-sources.noConfig': 'No data sources configured. Add them in the workbench card or plugin config (dataSources).',
  'cmd.data-sources.result': 'Data sources ({count}):\n{sources}',
  'cmd.data-test.desc': 'Test one data source connection (introspection round-trip)',
  'cmd.data-test.usage': 'Usage: /data-test <datasource>',
  'cmd.data-test.unknown': 'Unknown datasource "{0}". Try /data-sources.',
  'cmd.data-test.success': '✓ {name} ({type}) connected in {elapsed}ms — {tables} tables/views.',
  'cmd.data-test.fail': '✗ {name} ({type}) failed: {err}',
  'cmd.data-reload.desc': 'Reload the semantic layer file (also hot-reloads on save)',
  'cmd.data-reload.noFile': 'No semantic file configured — set semanticFile in the workbench card or plugin config.',
  'cmd.data-reload.fail': 'Semantic layer reload FAILED (kept last good config):\n{err}',
  'cmd.data-reload.success': '✓ Semantic layer reloaded from {file}{files}: {metrics} metrics, {entities} entities, {terms} terms.{lint}',
  'cmd.data-reload.includeNote': ' ({count} files via include)',
  'cmd.data-reload.lintWarn': '\n⚠️ {count} lint warning(s) — run /data-semantic-lint for details',
  'cmd.data-reload.lintClean': '\n✓ Semantic layer lint is clean',
  'cmd.data-semantic-lint.desc': 'Health-check the semantic layer config (non-blocking issues)',
  'cmd.data-semantic-lint.noFile': 'No semantic file configured — set semanticFile in the workbench card or plugin config.',
  'cmd.data-semantic-lint.header': '{files} files include from root · {metrics} metrics / {entities} entities / {terms} terms',
  'cmd.data-semantic-lint.fail': 'Semantic layer load failed (currently using last good config):\n{err}\n{header}',
  'cmd.data-semantic-lint.pass': '✓ Semantic layer health-check passed\n{header}',
  'cmd.data-semantic-lint.warnings': '⚠️ Semantic layer health-check: {count} warnings (non-blocking)\n{header}\n\n{lines}',
  'cmd.data-schema.desc': 'Show tables/columns of a data source',
  'cmd.data-schema.usage': 'Usage: /data-schema <datasource> [table]',
  'cmd.data-schema.notFound': 'Table "{table}" not found in "{ds}".',
  'cmd.data-schema.result': '{ds}: {count} tables\n{lines}{note}',
  'cmd.data-sql.desc': 'Run one read-only SELECT directly (result stays out of model history)',
  'cmd.data-sql.usage': 'Usage: /data-sql <datasource> <select statement>',
  'cmd.data-sql.unknown': 'Unknown datasource "{0}". Try /data-sources.',
  'cmd.data-sql.success': 'OK — {count} rows{note}\n{table}',
  'cmd.data-dashboard.desc': 'Export all session charts as one self-contained HTML dashboard',
  'cmd.data-dashboard.noCharts': 'No charts to export yet — ask the agent to render a chart first.',
  'cmd.data-dashboard.success': 'Dashboard exported: {file}\n{count} charts, self-contained (works offline). Tip: each chart node in the chat also has per-chart HTML/PNG/CSV export buttons.',
  'cmd.data-csv.desc': 'Export the latest query result as CSV',
  'cmd.data-csv.noResults': 'No cached results in this session yet.',
  'cmd.data-csv.success': 'CSV exported: {file} ({count} rows)',
  'tool.list_data_sources.desc': 'List the configured data sources (SQLite / MySQL / PostgreSQL / Spark) with engine, dialect, and approval mode. Call this first when unsure which sources exist.',
  'tool.inspect_schema.desc': "Inspect a data source's schema: tables/views, columns with types and comments, row estimates, and optional sample rows. Read this BEFORE writing SQL. Schema is cached briefly; pass refresh to re-introspect after suspected DDL changes.",
  'tool.inspect_schema.ok': 'Schema of "{ds}" — {count} tables{truncated}:',
  'tool.inspect_schema.samples': 'Samples',
  'tool.run_sql.desc': 'Execute ONE read-only SELECT against a data source (text2SQL: you write the SQL). Guardrails: single SELECT/WITH statement only, LIMIT auto-injected when missing, per-source row cap and timeout enforced. Returns a resultId you can pass to render_chart without re-sending rows. Always inspect_schema first; state your intent in "reason" (shown to the approver and in the audit trail).',
  'tool.run_sql.ok': 'Query OK on "{ds}" — {count} rows, columns: {columns}.',
  'tool.run_sql.truncatedNote': '\nNote: the result filled the row cap — there may be more rows. Aggregate in SQL or refine filters for totals instead of paging.',
  'tool.run_sql.resultIdHint': 'resultId: {rid}  ← pass THIS value to render_chart to chart the full result',
  'tool.render_chart.desc': 'Render an interactive ECharts visualization INSIDE the chat and enable HTML/PNG/CSV export. Three data sources, in order of preference: (1) resultId from the last run_sql — charts the FULL result even when only a preview was shown to you; (2) sql — a single SELECT executed freshly under the same guardrails; (3) inline data rows for values not from a query. Chart option JSON is built by the platform — you only declare intent: chartType, fields, title. Prefer chartType "auto": the platform inspects the result shape (cardinality, time-like columns, numeric column count) and picks the most readable family. Use boxplot for distributions (quartiles per category) and funnel for stage conversion.',
  'tool.render_chart.rendered': 'Chart rendered in the conversation (chartId {cid}, {points} points). The user sees an interactive chart with HTML/PNG/CSV export buttons.',
  'tool.analyze_data.desc': 'Run a built-in statistical analysis over a base SELECT: profile (per-column stats), topn (group-by top N), correlation (Pearson between two numeric columns), distribution (histogram), insight (headline stats, trend direction, top contributors with share, Pareto concentration, z-score outliers; optional dimension/metric/topN). Pass the base SQL; derived queries are generated and executed for you.',
  'tool.analyze_data.complete': 'Analysis "{analysis}" complete — interpret the numbers below and state findings with evidence:',
  'tool.list_semantic.desc': 'List the semantic layer catalog: governed metrics with their口径 (formula/grain/dimensions/unit), business terms, and table/column business labels. Prefer these governed metrics over hand-written SQL whenever a question maps to one. Pass the metric name to query_metric.',
  'tool.list_semantic.error': 'Semantic layer load error (using last good config)',
  'tool.list_semantic.noFile': '(no semantic file configured — set semanticFile in the workbench card or plugin config to enable)',
  'tool.list_semantic.lintWarn': '⚠️ Semantic layer health-check: {count} warnings (non-blocking, fix when convenient):',
  'tool.list_semantic.metricsHeader': 'Governed metrics 指标目录:',
  'tool.list_semantic.termsHeader': 'Business terms 业务术语:',
  'tool.list_semantic.entitiesHeader': 'Entities 业务表:',
  'tool.list_semantic.filesHeader': 'Composed files ({count} via include, latter overrides former):',
  'tool.list_semantic.empty': 'Semantic layer is empty.',
  'tool.list_semantic.formula': 'Formula',
  'tool.list_semantic.filters': 'Fixed filters',
  'tool.query_metric.desc': 'Query a GOVERNED metric from the semantic layer (统一口径, audit-safe). Builds the SQL from the metric definition — you only pick the metric id, optional declared dimensions, dimension value filters, and an optional from/to time range. Returns rows plus a resultId for render_chart. Prefer this over run_sql whenever a list_semantic metric matches the question.',
  'tool.query_metric.cardPrefix': 'Metric query',
  'tool.query_metric.render.success': 'Metric "{metric}" OK on "{ds}" — {count} rows.{note}\nresultId: {rid}  ← pass THIS to render_chart\nSQL (generated from the governed definition):\n{sql}\n\n{table}',
  'tool.query_metric.missingDatasource': 'Metric "{metric}" resolves to datasource "{ds}" which is not configured. Fix the semantic layer or add the connection.',
  'lint.duplicate-definition.message': 'Duplicate definition — the version from {winner} is used; the one in {loser} is discarded',
  'lint.duplicate-definition.hint': 'Safe to ignore if the override is intentional; otherwise use extends, or override only the fields you actually change',
  'lint.unknown-dimension-column.message': 'Dimension {names} is not declared in entity "{entity}".columns',
  'lint.unknown-dimension-column.hint': 'Add the column to the entity or fix the dimension name — it is interpolated into GROUP BY and fails at query time',
  'lint.unknown-measure-column.message': 'Measure column "{column}" is not declared in entity "{entity}".columns',
  'lint.unknown-measure-column.hint': 'Add the column to the entity, or fix measure',
  'lint.unknown-timefield-column.message': 'Time column "{column}" is not declared in entity "{entity}".columns',
  'lint.unknown-timefield-column.hint': 'The from/to range filter is applied to this column',
  'lint.duplicate-dimension.message': 'Dimension {names} is declared more than once',
  'lint.duplicate-dimension.hint': 'A repeated dimension appears twice in GROUP BY',
  'lint.count-with-measure.message': 'With agg: count the measure "{measure}" is ignored (the generated SQL is COUNT(*))',
  'lint.count-with-measure.hint': 'Use agg: count_distinct if you want distinct counting',
  'lint.term-alias-collision.message': 'Term "{term}" name/alias "{name}" collides with term "{owner}"',
  'lint.term-alias-collision.hint': 'Ambiguous 口径 makes the model pick the wrong term — merge them or rename the alias',
  'lint.metric-shadows-term.message': 'Metric name "{metric}" is identical to term "{term}"',
  'lint.metric-shadows-term.hint': 'Both the metric catalog and the term list are injected into the prompt; identical names are ambiguous',
  'lint.unbounded-metric.message': 'No timeField and no fixed filters — queries aggregate the whole table',
  'lint.unbounded-metric.hint': 'Add a timeField to support range filters, or constrain the口径 in filters',
  'lint.missing-label.message': '{count} metric(s) have no label, so the model only sees the id: {names}',
  'lint.missing-label.hint': 'label is the human name shown in the catalog and the prompt — worth filling in',
  'tool.render_chart.cardPrefix': 'Chart',
  'tool.analyze_data.cardPrefix': 'Analysis',
  'config.validate.gte': '{field} must be >= {min}',
  'config.validate.gteMs': '{field} must be >= {min}ms',
  'config.validate.defaultDatasource': 'defaultDatasource "{name}" matches none of the configured datasources (dataSources: {list})',
  'export.html.byline': 'Exported by RD Data Analysis Agent · {time} · {count} chart(s) · interactive offline',
  'export.html.footer': 'See the "SQL" disclosure on each chart for data provenance. This is a self-contained interactive page — open it directly in a browser.',
}
