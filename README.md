# dsh-data-analysis-agent

**Data Analysis Agent plugin for DeepSeek Harness**

面向 [deepseek-harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) 的数据分析智能体插件。提供多数据源接入、自然语言 text2SQL（带解析级护栏）、声明式语义层（热加载）、Web 工作台连接管理、对话内交互式 ECharts 可视化、内置统计分析及自包含 HTML 图表导出。基于官方插件开发指南构建，采用双面插件（Host 半 + Browser 半），不修改官方仓库任何代码。

> 状态：已在本地 dsh 源码上完成端到端实测（真实对话 → 工具链 → 图表渲染 → 导出 → 重启重放 → 工作台热配置）。单元/集成测试全绿（`npm test`，覆盖矩阵见下文）。

---

## 功能概览

| 模块 | 核心能力 |
|---|---|
| **多数据源** | SQLite / MySQL / PostgreSQL / ClickHouse / DuckDB / Spark(Mock 或 Livy REST 真后端)，统一 `DataSourceProvider` 接口，Schema 内省（聚合查询，无逐表 N+1）+ TTL 缓存 |
| **语义层** | YAML 声明式 entities/terms/metrics（轻量分析本体：概念/属性/具名关系/枚举值域）；`include` 多文件拆分 + 实体与指标 `extends` 继承复用，`fs.watch` + 防抖热加载（覆盖 include 全图），加载后语义体检（告警不阻塞），业务口径 + 枚举值域 + 关系叠加进 `inspect_schema`，支持 `query_metric` 受治理 SQL 生成（跨实体 `joins`） |
| **text2SQL** | `node-sql-parser` 解析级白名单（仅单条 SELECT/WITH），LIMIT 自动注入**与收敛**（自带大 LIMIT 也会被钳制到行上限），注释混淆的危险语句照拦，语句级超时，行数硬上限，`approval` 审批门（覆盖 run_sql / analyze_data / run_query_async / render_chart(sql) / query_metric 全部 SQL 执行路径），`reason` 审计 |
| **统计分析** | `profile`（逐列画像）/ `topn`（Top-N）/ `correlation`（Pearson 相关）/ `distribution`（直方图分箱）/ `insight`（综合洞察），NULL/空值不参与统计 |
| **可视化** | Apache ECharts 6，八种图型（line/bar/pie/scatter/heatmap/KPI/boxplot/funnel），Host 侧构建完整 option，SVG 渲染，重启后持久化重放 |
| **导出** | 单图自包含 HTML（离线交互 + 跨图筛选）、PNG(2x)、CSV、`/data-dashboard` 仪表板、`/data-csv` 数据导出 |
| **命令** | `/data-sources` `/data-test` `/data-schema` `/data-sql` `/data-dashboard` `/data-csv` `/data-reload` `/data-semantic-lint` `/data-semantic-validate` `/data-export-png` `/data-history` |
| **安全** | `!!js process.env.*` 注入，密码 `role: 'secret'` 不回显，Web 工作台保存即热生效，TLS 默认校验证书（自签名需显式 `sslSkipVerify`） |

---

## 快速开始

```sh
# 1. 依赖 + 链接本地 dsh checkout（运行时单例一致）
#    checkout 不在常见位置时：npm run setup:links -- /path/to/deepseek-harness
#    或设置环境变量 DSH_CHECKOUT=/path/to/deepseek-harness
npm install && npm run setup:links

# 2. 构建 + 生成演示库
npm run build && npm run demo:seed

# 3. 以 profile 方式安装到独立 DSH_HOME
cd <dsh-checkout-path>
DSH_HOME=~/.dsh-rd pnpm dsh plugin --profile rd add <plugin-path>

# 4. 配置数据源：编辑 ~/.dsh-rd/profiles/rd/cordis.patch.yml
#    （参考 dev/cordis.overlay.yml 示例）

# 5. 启动
DSH_HOME=~/.dsh-rd pnpm dsh --profile rd --port 3199 --no-open
```

打开 `http://127.0.0.1:3199`，在对话中直接提问：

> 用 demo 数据源画一张每天 revenue 的趋势线，再看看各状态订单量占比

### 开发命令

| 命令 | 说明 |
|---|---|
| `npm run watch` | 热构建（client 半变更需刷新页面） |
| `npm test` | 运行 Vitest |
| `npm run typecheck` | TypeScript 类型检查（前置：`npm run setup:links` 软链 `@deepseek-ai/*`） |
| `npm run setup:links` | 把 `@deepseek-ai/*` 软链到本地 dsh checkout（可用参数或 `DSH_CHECKOUT` 指定位置） |

浏览器 E2E（`tests/e2e-dashboard.spec.ts`）验证导出的自包含看板在真实浏览器里能画出来、点击能跨图筛选、筛选能靠 URL hash 还原——它依赖可选的 `playwright` devDependency，未安装时该 suite 自动 skip：

```bash
npm i -D playwright && npx playwright install chromium
```

### 纯 Host 用法（不需要 UI）

`--patch` overlay 直接指向 `lib/index.js` 绝对路径即可（参考 `dev/cordis.overlay.yml`）。

---

## 配置

### 插件配置

```yaml
- id: data-analysis
  config:
    semanticFile: /path/to/semantic.yaml   # 语义层配置（可选，热加载）
    defaultMaxRows: 500          # 单查询行上限（注入 LIMIT + 硬截断）
    defaultTimeoutMs: 20000      # 语句超时
    modelRowCap: 50              # 模型可见行数（其余经 resultId 引用）
    chartDataCap: 500            # 单图最大数据点
    schemaCacheTtlMs: 300000     # Schema 缓存
    exportDir: ''                # /data-dashboard 输出目录，默认 ~/Downloads/dsh-exports
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
      - name: ck-log
        type: clickhouse
        host: http://ck-prod
        database: logs
        user: readonly
        password: !!js process.env.CK_PASSWORD
      - name: spark-lake
        type: spark              # v1 为 Mock，真实后端见下方路线
```

以上全部字段也可在 **设置 → 插件 → 数据库工作台** 卡片里在线编辑（保存即热生效，密码留空保持不变）。

### 语义层配置

三类条目（参考 dsh-data-analysis-agent Catalog 的 meaning/term/metric 设计，落成声明式 YAML）：

| 条目 | 作用 |
|---|---|
| `entities` | meaning：表/列的业务含义，叠加进 `inspect_schema` 的输出 |
| `terms` | term：业务术语与别名，注入系统提示词统一口径 |
| `metrics` | metric：可执行指标定义，`query_metric` 按此生成受治理的 SQL |

这组构件构成一个**轻量分析本体**（OBDA 风格：本体是虚拟视图层，实例留在数据库里，查询经本体编译成 SQL）：`entities` 是概念、`columns` 是属性、`relationships` 是具名的对象关系、`terms` 是词汇层、lint 规则是轻量公理。刻意保持最小承诺——数据类型不重复声明（来自内省），只承诺 text2SQL 治理所需要的部分。

完整示例见 `demo/semantic.yaml`（组合根）与 `demo/semantic/`（拆分后的实体/术语/指标文件）。

#### 多文件拆分：`include`

一个文件塞几十个指标会变得没法 review。根文件用 `include` 按域拆开：

```yaml
include:
  - ./semantic/entities.yaml        # 具体路径
  - ./semantic/metrics              # 目录简写（只取该层的 *.yaml）
  - ./semantic/domains/**/*.yaml    # 递归 glob（* / ** / ? 均支持，零依赖实现）
defaults:
  datasource: demo
```

- **合并顺序**：被 include 的文件在前、include 它的文件在后，所以**后加载的覆盖先加载的**（同 `table` / 同 `name` 视为同一条目）。刻意覆盖共享 base 是合法用法，但同名冲突会记一条 `duplicate-definition` 告警，并点名被丢弃的那个文件。
- **环安全**：`a → b → a` 不会死循环，每个文件只贡献一次。
- **拼错即报错**：`include` 一个都匹配不到时直接加载失败（沿用上一次有效配置），而不是静默丢掉半个目录。
- **热加载覆盖全图**：include 进来的每个文件及其所在目录都在监听范围内 —— 改任意一个文件会重载，glob 目录里新增文件同样会触发（文件级 watch 看不到新文件，所以目录也在监听集合里）。

#### 复用：三层继承（defaults → entity → extends → metric）

```yaml
defaults:
  datasource: demo
entities:
  - table: daily_revenue
    timeField: dt          # 该实体下所有指标默认按 dt 看时间
    dimensions: [tenant]
metrics:
  - name: paid_amount      # 基础口径：只统计已支付金额
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]
  - name: daily_revenue
    extends: paid_amount   # 只声明自己要改的字段
    label: 每日收入
    timeField: created_at
    dimensions: [status, user_id]
```

- **标量字段**（`datasource` / `entity` / `measure` / `agg` / `timeField` / `dimensions` / `unit` / `label` …）：最近的声明生效，优先级为 `defaults` → `entity` → `extends` 链 → 指标自身。
- **`filters` 是唯一例外：逐级累加（AND）**。子指标声明自己的过滤条件不会顶掉基础口径 —— 口径是约束，不该被"重写"掉。完全相同的谓词会去重。
- `extends` 支持多层；链的根节点（没有 `extends` 的那一个）必须自己声明 `entity` 与 `agg`。`extends` 在组合阶段就被解析掉，下游（SQL 构建 / 指标目录 / 提示词）拿到的永远是自包含指标。

#### 本体构件：relationships / key / values / 实体继承

```yaml
entities:
  - table: orders
    key: id                  # 主键列（inspect_schema / catalog 标注 PK）
    relationships:           # 具名关系：订单 → 下单用户（join 路径）
      - entity: users
        on: [user_id, id]
        name: 下单用户
        cardinality: many-to-one   # 默认 many-to-one
    columns:
      - name: status
        label: 订单状态
        values:              # 枚举值域：模型可见，lint 校验 filters 取值
          - { value: paid, label: 已支付 }
          - { value: refunded, label: 已退款 }
metrics:
  - name: daily_city_revenue
    entity: orders
    joins: [users]           # 通过 relationships 联表（支持多跳，≤3 跳）
    dimensions: [users.city] # 联表后可用 Entity.column 形式引用
    measure: amount
    agg: sum
```

- **`relationships`** 是实体间的对象关系：`on` 是 join 列对，`name`/`cardinality` 给模型可读的语义。指标用 `joins: [目标实体]` 联表后，维度/过滤/度量即可引用 `Entity.column`。
- **`key`** 声明主键列，让模型知道"一行是什么"。
- **`values`** 声明枚举列的值域，叠加进 `inspect_schema`；lint 会校验指标 `filters` 里的 `= 'x'` / `IN (…)` 取值是否在值域内（`enum-filter-value-unknown`）。
- **实体也能 `extends`**：子实体按字段合并继承列标注（子覆盖同名列的对应字段）、继承关系与主键；`filters` / `rowFilter` 同样逐级累加。继承关系也参与 `joins` 可达性判定。
- **scaffold 自动推断**：工作台"从数据源生成"会按命名约定推断 `X_id` 外键关系（`many-to-one`）和 `id` 主键，生成的起步层天然支持跨表指标。
- 编辑器保全：工作台语义编辑器保存时，无表单控件的字段（relationships/values/ratio 两侧/joins/expression…）原样写回，不会因为改了一个指标就丢掉手写的结构。

#### 体检：`/data-semantic-lint`

语法与结构错误会让加载直接失败（沿用上一次有效配置）；"能加载、但大概率是笔误"的语义问题记为**告警，不阻塞查询**，在 `list_semantic` 输出和 `/data-semantic-lint` 里可见：

| code | 含义 |
|---|---|
| `duplicate-definition` | 同名 entity/term/metric 被覆盖，点名被丢弃的来源文件 |
| `unknown-dimension-column` | 维度未在该 entity 的 `columns` 中声明（拼错会在 GROUP BY 时直接报错） |
| `unknown-measure-column` / `unknown-timefield-column` | 度量列 / 时间列未声明 |
| `duplicate-dimension` | 同一维度在 `dimensions` 里重复 |
| `count-with-measure` | `agg: count` 却写了 `measure`（生成的是 `COUNT(*)`，该字段被忽略） |
| `term-alias-collision` | 两个术语的名称/别名撞车，模型会选错口径 |
| `metric-shadows-term` | 指标名与术语同名，提示词中出现歧义 |
| `unbounded-metric` | 既无 `timeField` 也无 `filters`，查询会全表聚合 |
| `missing-label` | 缺 `label` 的指标数（汇总成一条），模型只能看到 id |
| `relationship-column-missing` | 关系的 join 列未在实体 `columns` 中声明 |
| `unknown-key-column` | 实体 `key` 主键列未在 `columns` 中声明 |
| `enum-filter-value-unknown` | 指标 filters 对枚举列使用了 `values` 值域之外的取值 |

有意不做的一件事：**不检查 `filters` 里的任意列名**。它是刻意保留的自由 SQL 谓词（从 `status = 'paid'` 到 `dt >= date_sub(now(), interval 7 day)`），用正则去猜列名只会产出更多误报。唯一的例外是**声明了 `values` 值域的枚举列**：配置明确承诺过取值集合，此时 `= 'x'` / `IN (…)` 的比较才被校验——这是精确匹配，不是猜测。

---

## 架构

```
┌─ Host 半 (src/index.ts → lib/index.js) ─────────────────────────┐
│ DataSourceRegistry                                                │
│   ├ sqlite(node:sqlite)   ├ mysql(mysql2)                       │
│   ├ postgres(pg)          ├ clickhouse(HTTP)                     │
│   ├ duckdb(懒加载可选驱动) ├ spark(seam: Mock / Livy REST)       │
│ tools: list_data_sources / inspect_schema / run_sql /            │
│        render_chart / analyze_data / query_metric /              │
│        list_semantic / run_query_async / get_query_job /         │
│        get_result_rows                                           │
│ sql/guard.ts: 解析级白名单 + LIMIT 注入与收敛                     │
│ approval.ts: 按数据源 ask/auto（覆盖全部 SQL 执行路径）           │
│ charts/echarts-option.ts: 意图 → 完整 ECharts option             │
│ semantic/: 语义层（load/include/compose/lint/drift/scaffold/      │
│            serialize；本体构件 + 实体/指标继承 + 体检）           │
│ analysis/: profile/topn/correlation/distribution/insight         │
│ jobs.ts 异步任务  audit.ts 审计  commands: /data-*               │
└────────────────────────┬────────────────────────────────────────┘
                         │ tool/result (presentationMeta)
┌─ Browser 半 (src/client/ → lib/client.js) ──────────────────────┐
│ rdChartDefinition: match tool/result → 节点（幂等 chartId）       │
│ RdChartNodeView: ECharts SVG + 导出 HTML/PNG/CSV + 复制 SQL     │
│ settings-card/semantic-section: 数据库工作台热配置               │
│ export-html.ts: 自包含离线单文件（内联 echarts UMD）             │
└──────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

- **不发明自定义会话事件类型**：dsh 会话持久化按"已知事件目录"校验，out-of-tree 类型若无 `ignorable` 标记会导致整条日志被拒读。因此图表载荷挂在 `tool/result` 的 `presentationMeta` 上——同样持久、可重放、对任何构建安全。
- **`@deepseek-ai/*` 永远 external**：cordis DI / 工具注册表是宿主单例，打进包会出现第二实例破坏服务身份。
- **client 半是加载器的 lazy-CJS 工厂产物**：`window.__ModuleLoader__.load({id, factory})`，React 等平台模块走注入 require，ECharts 内联。

---

## Spark 真实接入路线（同一 `DataSourceProvider` seam）

1. **Apache Livy REST**（已实现，`src/datasources/spark-livy.ts`）：纯 HTTP（`POST /sessions` → `/statements` → 轮询），Node 零原生依赖；`sparkMock: false` + `livyUrl` 即接入。当前实现每查询新建/销毁 session，高并发场景建议后续加 session 池。
2. **Spark Connect**（Spark 3.4+ 官方 gRPC）：Node 无成熟客户端，建议 Python sidecar（pyspark）经 localhost HTTP 桥或 `code-runtime-python` 线协议驱动。
3. **HiveServer2/Thrift**：遗留集群；Node Thrift 支持弱，同样建议 sidecar（pyhive）。

长查询务必走 `ctx.jobs.start` 异步任务 + 结果落地（Parquet/CSV），不要把大结果集回传对话。

---

## 验证矩阵

| 类别 | 覆盖内容 |
|---|---|
| **单元/集成测试（vitest）** | SQL guard 拒绝矩阵、LIMIT 注入与收敛、注释混淆拒绝、标识符注入、ECharts option 全图型、导出 HTML XSS 转义、CSV 转义、分析统计（NULL 处理/topn 白名单/数值字符串画像）、sqlite 端到端（执行/内省/query_metric 端到端）、异步任务（状态机/取消/逐出/审计回调）、语义层（YAML 校验拒绝矩阵/指标 SQL 构建/维度白名单/值转义/热加载容错）、语义层组合（include 展开与 glob/环/覆盖、三层继承与 extends 链、filters 累加、lint 全规则、include 全图热加载）、ratio/expression/joins/RLS、demo 配置端到端跑真实 SQL |
| **真机（浏览器）** | 插件加载 → 真实对话（模型按注入工作流调用 list_data_sources → inspect_schema → run_sql → analyze_data → render_chart）→ 双数据源图表节点渲染（SQLite 171 天折线 + Spark Mock 环形图）→ 导出 HTML 离线打开可交互 → `/data-dashboard` 仪表板 → 服务重启后历史会话完整重放图表 → 语义层对话流（list_semantic → query_metric · daily_revenue → render_chart）→ 工作台卡片改配置保存 → settings user layer 持久化 + host 热重建 |

---

## 已知限制

- dsh 处于 developer preview，API 可能破坏性变更——本插件已锁定对接行为并附测试，升级需回归
- SQLite provider 同步执行（`node:sqlite`），超时不能中断运行中语句（行上限 + LIMIT 是有效约束）
- 会话内图表的内存注册表已移除，`/data-dashboard` 改从持久化日志读取（重启可用）
- PNG 导出依赖浏览器 canvas（KPI 卡无 PNG 按钮）
- Spark 默认 Mock；`sparkMock: false` + `livyUrl` 走真实 Livy（每查询新建 session，吞吐有限；text/plain 表格解析为尽力而为）
- 审计日志为内存环形缓冲，宿主重启即清零（量级需求出现后再考虑落盘 JSONL）

---

## 目录结构

```
data-agent/
├── package.json / cordis.patch.yml   # bundle 清单（dsh.bundle + dsh.client）
├── scripts/build.mjs                 # esbuild 双半构建（node ESM + client 工厂产物）
├── scripts/link-dsh.mjs              # dev:@deepseek-ai/* 符号链接到 dsh checkout
├── dev/cordis.overlay.yml            # 本地 --patch 联调 overlay（host-only）
├── demo/seed-demo.mjs                # 演示 SQLite 库
├── demo/semantic.yaml                # 语义层示例（组合根：include + defaults）
├── demo/semantic/                     # 拆分后的实体 / 术语 / 指标域文件
├── src/                              # host 半：config/registry/datasources/sql/schema/tools/commands/...
├── src/client/                       # browser 半：definition/ChartNodeView/export-html
├── src/shared/export-template.ts     # 两半共用的自包含 HTML 模板 + CSV
└── tests/                            # vitest：guard 矩阵 / option 构建 / sqlite e2e
```

---

## License

MIT
