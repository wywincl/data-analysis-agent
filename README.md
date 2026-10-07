# dsh-data-analysis-agent

> Data Analysis Agent plugin for DeepSeek Harness

给 [deepseek-harness（dsh）](https://github.com/deepseek-ai/deepseek-harness)加数据分析能力的插件：把数据库接进来，在对话里用自然语言查数、画图、导出报告。

它能做什么：

- **接数据库** — SQLite / MySQL / PostgreSQL / ClickHouse / DuckDB / Spark（Mock 或 Livy 真后端），YAML 配置，也可以在 Web 工作台里在线改，保存即生效
- **text2SQL 带护栏** — 模型生成的 SQL 先过解析级白名单（只放行单条 SELECT/WITH），自动注入并钳制 LIMIT，限制行数和语句超时；敏感数据源可以设成每次执行前人工审批
- **语义层** — 用 YAML 声明表列含义、业务术语、指标口径，改完热加载；模型可以走 `query_metric` 按治理过的口径取数，不用自己拼 SQL
- **内置分析** — profile 画像 / Top-N / 相关性 / 分布 / 综合洞察，模型不用手写统计 SQL
- **对话内图表** — 模型只描述"画什么"（意图），完整 ECharts option 由 Host 侧构建，共九种图型（含瀑布图、KPI 卡）；SVG 渲染，重启后历史会话照常重放
- **导出** — 单图或整个仪表板导出自包含 HTML（离线可交互、可跨图筛选），另有 PNG 和 CSV

插件分两半：Host 半跑在 Node 里（数据源、工具、SQL guard、语义层、分析），Browser 半跑在浏览器里（图表渲染、导出、工作台 UI）。不改 dsh 本身的代码。

### 斜杠命令

| 命令 | 作用 |
|---|---|
| `/data-sources` | 列出已配置的数据源及其状态 |
| `/data-test` | 测试某个数据源的连接 |
| `/data-schema` | 看数据源的表和列 |
| `/data-sql` | 直接跑一条只读 SELECT（结果不进入模型历史） |
| `/data-dashboard` | 把会话里的所有图表导出成一个自包含 HTML 仪表板 |
| `/data-csv` | 导出最近一次查询结果为 CSV |
| `/data-export-png` | 服务端把会话图表渲染为图片文件（优先 PNG，无 node-canvas 时降级 SVG） |
| `/data-history` | 查询审计：最近的记录和按数据源聚合的用量 |
| `/data-reload` | 手动重载语义层（保存时本来就会热加载） |
| `/data-semantic-lint` | 语义层体检（非阻塞告警） |
| `/data-semantic-validate` | 语义层和库内真实 schema 比对，抓表/列漂移 |

## 快速开始

需要 Node 22.5+（SQLite provider 依赖 `node:sqlite`）和一份本地 dsh 源码 checkout。

```sh
# 1. 装依赖，并把 @deepseek-ai/* 软链到本地 dsh checkout
#    checkout 不在常见位置时：DSH_CHECKOUT=/path/to/deepseek-harness npm run setup:links
npm install && npm run setup:links

# 2. 构建 + 生成演示数据库
npm run build && npm run demo:seed

# 3. 从 dsh checkout 启动，用 overlay 直接挂载本插件
cd /path/to/deepseek-harness
pnpm dsh web --patch /path/to/data-agent/dev/cordis.overlay.yml
```

打开终端里提示的本地地址，在对话中直接提问：

> 用 demo 数据源画一张每天 revenue 的趋势线，再看看各状态订单量占比

overlay 里预置了 demo（SQLite）和 spark-lake（Mock）两个数据源，正式配置见[配置](#配置)一节。也可以把插件装进独立的 dsh profile 长期使用：`DSH_HOME=~/.dsh-rd pnpm dsh plugin --profile rd add <plugin-path>`；从 GitHub 等远端安装时，构建靠 `prepare` 脚本在装包时触发，pnpm ≥10 默认拦截构建脚本，按 dsh 的提示把对应的 allowBuilds 条目加进 profile 的 `pnpm-workspace.yaml` 再重跑。

### 开发

| 命令 | 说明 |
|---|---|
| `npm run watch` | 监听构建（client 半的改动要刷新浏览器才生效） |
| `npm test` | 跑 Vitest |
| `npm run typecheck` | TypeScript 类型检查（需要先 `npm run setup:links`） |

浏览器 E2E（`tests/e2e-dashboard.spec.ts`）依赖可选的 playwright，没装会自动跳过：

```sh
npm i -D playwright && npx playwright install chromium
```

不想起 UI 也可以纯 Host 用：`--patch` overlay 指向构建产物 `lib/index.js` 的绝对路径即可，参考 `dev/cordis.overlay.yml`。

## 配置

### 数据源

```yaml
- id: data-analysis
  config:
    defaultMaxRows: 500          # 单查询行上限（注入 LIMIT + 硬截断）
    defaultTimeoutMs: 20000      # 语句超时
    modelRowCap: 50              # 模型可见行数，其余经 resultId 引用
    chartDataCap: 500            # 单图最大数据点
    schemaCacheTtlMs: 300000     # schema 缓存时长
    exportDir: ''                # /data-dashboard 输出目录，默认 ~/Downloads/dsh-exports
    semanticFile: /path/to/semantic.yaml   # 语义层（可选，热加载）
    dataSources:
      - name: demo
        type: sqlite
        file: /path/to/demo.db
        approvalMode: auto       # auto | ask
      - name: shop-mysql
        type: mysql
        host: 10.0.0.5
        port: 3306
        database: shop
        user: analytics_ro
        password: !!js process.env.MYSQL_ANALYTICS_PASSWORD
        approvalMode: ask
```

以上字段都能在 **设置 → 插件 → 数据库工作台** 里在线编辑，保存即热生效（密码留空表示保持不变）。密码不要写明文，用 `!!js process.env.*` 从环境变量注入；相对的 sqlite `file` 路径按插件包根解析。

### 语义层

语义层用 YAML 回答三个问题：

| 条目 | 回答的问题 |
|---|---|
| `entities` | 数据是什么 — 表/列的业务含义、主键、枚举值域、实体间关系，叠加进 `inspect_schema` 给模型看 |
| `terms` | 业务黑话指什么 — 术语和别名注入系统提示词，统一口径 |
| `metrics` | 指标怎么算 — 可执行的指标定义，`query_metric` 按它生成受治理的 SQL |

一个能说明大部分特性的例子：

```yaml
defaults:
  datasource: demo

entities:
  - table: orders
    key: id                     # 主键，让模型知道"一行是什么"
    columns:
      - name: status
        label: 订单状态
        values:                 # 枚举值域：模型可见，lint 也会校验
          - { value: paid, label: 已支付 }
          - { value: refunded, label: 已退款 }
    relationships:              # 具名关系 = 可复用的 join 路径（cardinality 默认 many-to-one）
      - entity: users
        on: [user_id, id]
        name: 下单用户

metrics:
  - name: paid_amount           # 基础口径：已支付金额
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]

  - name: daily_city_revenue    # 派生口径：只声明差异，其余继承
    extends: paid_amount
    label: 每日城市收入
    timeField: created_at
    joins: [users]              # 走 relationships 联表（支持多跳，≤3 跳）
    dimensions: [users.city]
```

完整示例见 `demo/semantic.yaml`（组合根）和 `demo/semantic/`（按域拆分后的实体/术语/指标文件）。

几个设计要点：

- **文件大了就拆**。根文件用 `include` 引入子文件、目录或 glob，改其中任何一个都会热重载（目录里新增文件同样触发）。`include` 一个都匹配不到会直接加载失败（沿用上一次有效配置），不会静默丢掉半个目录；同名条目后加载的覆盖先加载的，并记一条告警。
- **继承复用**。`extends` 支持多层：标量字段就近覆盖，`filters` 逐级累加（AND）——口径是约束，不该被子指标"重写"掉。实体也能 `extends`，按字段合并列标注、继承关系和主键。
- **组合在加载时完成**。`extends` 在组合阶段就被解析掉，下游（SQL 构建、指标目录、提示词）拿到的永远是自包含的指标。
- **起步层可以生成**。工作台"从数据源生成"会按命名约定推断 `X_id` 外键关系和 `id` 主键，生成的语义层天然支持跨表指标；编辑器保存时不会丢掉表单之外手写的字段（relationships / values / joins / expression 原样写回）。
- **最小承诺**。数据类型不重复声明（来自内省），语义层只声明 text2SQL 治理所需要的部分。

#### 体检

配置加载后跑一轮 lint：结构性错误直接加载失败；"能加载、但大概率是笔误"的问题记成告警，不阻塞查询，在 `list_semantic` 输出和 `/data-semantic-lint` 里可见。

| code | 含义 |
|---|---|
| `duplicate-definition` | 同名条目被覆盖，点名被丢弃的来源文件 |
| `unknown-dimension-column` | 维度列未在 entity 的 `columns` 里声明 |
| `unknown-measure-column` / `unknown-timefield-column` | 度量列 / 时间列未声明 |
| `duplicate-dimension` | `dimensions` 里有重复维度 |
| `count-with-measure` | `agg: count` 却写了 `measure`（会被忽略） |
| `term-alias-collision` | 两个术语的名称/别名撞车，模型会选错口径 |
| `metric-shadows-term` | 指标名和术语同名，提示词里有歧义 |
| `unbounded-metric` | 既无 `timeField` 也无 `filters`，一查就全表聚合 |
| `missing-label` | 缺 `label` 的指标（模型只能看到 id） |
| `relationship-column-missing` | 关系的 join 列未在 `columns` 里声明 |
| `unknown-key-column` | 主键列未在 `columns` 里声明 |
| `enum-filter-value-unknown` | filters 用了枚举值域之外的取值 |

刻意不做的一件事：不校验 `filters` 里的任意列名。filters 是刻意保留的自由 SQL 谓词（从 `status = 'paid'` 到 `dt >= date_sub(now(), interval 7 day)`），拿正则去猜列名只会产出误报。唯一的例外是声明了 `values` 的枚举列——配置明确承诺过取值集合，这时才校验比较取值是否在值域内。

## 架构

```
┌─ Host 半 (src/index.ts → lib/index.js) ─────────────────────────┐
│ DataSourceRegistry                                                │
│   ├ sqlite(node:sqlite)   ├ mysql(mysql2)                        │
│   ├ postgres(pg)          ├ clickhouse(HTTP)                     │
│   ├ duckdb(懒加载可选驱动) ├ spark(seam: Mock / Livy REST)        │
│ tools: list_data_sources / inspect_schema / run_sql /            │
│        render_chart / analyze_data / query_metric /              │
│        list_semantic / run_query_async / get_query_job /         │
│        get_result_rows                                           │
│ sql/guard.ts: 解析级白名单 + LIMIT 注入与收敛                     │
│ approval.ts: 按数据源 ask/auto，覆盖全部 SQL 执行路径             │
│ charts/echarts-option.ts: 意图 → 完整 ECharts option             │
│ semantic/: load / include / compose / lint / drift / scaffold    │
│ analysis/: profile / topn / correlation / distribution / insight │
│ jobs.ts 异步任务   audit.ts 审计+成本   commands.ts /data-*       │
└────────────────────────┬─────────────────────────────────────────┘
                         │ tool/result (presentationMeta)
┌─ Browser 半 (src/client/ → lib/client.js) ──────────────────────┐
│ chart definition: match tool/result → 对话节点（幂等 chartId）    │
│ ChartNodeView: ECharts SVG + 导出 HTML/PNG/CSV + 复制 SQL        │
│ settings-card / semantic-section: 数据库工作台热配置              │
│ export-html.ts: 自包含离线单文件（内联 echarts UMD）              │
└──────────────────────────────────────────────────────────────────┘
```

两个值得知道的设计决定：

- **图表不发明自定义会话事件**。dsh 的会话持久化按"已知事件目录"校验，自造的 out-of-tree 事件类型可能导致整条日志被拒读。所以图表载荷挂在 `tool/result` 的 `presentationMeta` 上——同样持久、可重放，对任何 dsh 构建都安全。
- **`@deepseek-ai/*` 永远 external**。cordis 的 DI 容器和工具注册表是宿主单例，打进包里会出现第二个实例、破坏服务身份。运行时靠 `scripts/link-dsh.mjs` 的软链解析到 dsh checkout。

Browser 半是给 `window.__ModuleLoader__.load({id, factory})` 用的 lazy-CJS 工厂产物：React 等平台模块走注入 require，ECharts 内联。

## Spark 接入路线

- **Livy REST**（已实现，`src/datasources/spark-livy.ts`）：纯 HTTP，Node 零原生依赖，`sparkMock: false` + `livyUrl` 即接入。目前每个查询新建/销毁 session，高并发需要加 session 池。
- **Spark Connect**（3.4+ 官方 gRPC）和 **HiveServer2/Thrift**：Node 侧没有成熟客户端，建议 Python sidecar（pyspark / pyhive）经 localhost 桥接。

给新 provider 作者的提醒：长查询走 `ctx.jobs.start` 异步任务、结果落地（Parquet/CSV），不要把大结果集回传对话。

## 测试

`npm test` 覆盖：SQL guard 拒绝矩阵、LIMIT 注入与收敛、标识符注入、ECharts option 全图型、导出 HTML/CSV 转义、分析统计与 NULL 处理、sqlite 端到端（执行/内省/query_metric）、异步任务状态机、语义层（校验拒绝矩阵、include 组合与 glob、三层继承、lint 全规则、热加载容错）、demo 配置跑真实 SQL。

浏览器 E2E 验证导出的看板在真实浏览器里能渲染、能跨图筛选、筛选状态能靠 URL hash 还原。此外在本地 dsh 源码上做过完整链路的人工验证：真实对话 → 工具调用 → 图表渲染 → 导出 → 服务重启重放 → 工作台热配置。

## 已知限制

- dsh 还在 developer preview，API 可能有破坏性变更。插件锁定了对接行为并有测试盯着，升级 dsh 要跑一遍回归
- SQLite provider 是同步执行（`node:sqlite`），超时打不断正在跑的语句——行数上限和 LIMIT 注入才是实际有效的约束
- 审计日志在内存里（环形缓冲），宿主重启即清零；量级需求出现后再考虑落盘
- PNG 导出走浏览器 canvas，KPI 卡没有 PNG 按钮
- Spark 默认 Mock；Livy 模式每个查询新建 session，text/plain 表格解析是尽力而为
- `/data-dashboard` 从持久化日志读取图表，重启后仍可用

## 目录结构

```
data-agent/
├── cordis.patch.yml              # bundle 清单（dsh.bundle + dsh.client）
├── scripts/build.mjs             # esbuild 双半构建
├── scripts/link-dsh.mjs          # @deepseek-ai/* 软链到 dsh checkout
├── dev/cordis.overlay.yml        # 本地 --patch 联调 overlay
├── demo/                         # 演示库 seed + 语义层示例（组合根 + 拆分域文件）
├── src/                          # host 半：config/registry/datasources/sql/semantic/...
├── src/client/                   # browser 半：节点视图/工作台/导出
├── src/shared/export-template.ts # 两半共用的自包含 HTML + CSV 模板
└── tests/                        # vitest
```

## License

MIT
