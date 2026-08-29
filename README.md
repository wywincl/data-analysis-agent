# dsh-rd-data-analysis

**DeepSeek Harness 数据库工作台 & 数据分析智能体插件**

面向 [deepseek-harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) 的数据库工作台与数据分析智能体平台插件。提供多数据源接入、自然语言 text2SQL（带解析级护栏）、声明式语义层（热加载）、Web 工作台连接管理、对话内交互式 ECharts 可视化、内置统计分析及自包含 HTML 图表导出。基于官方插件开发指南构建，采用双面插件（Host 半 + Browser 半），不修改官方仓库任何代码。

> 状态：已在本地 dsh 源码上完成端到端实测（真实对话 → 工具链 → 图表渲染 → 导出 → 重启重放 → 工作台热配置）。48 个单元/集成测试全绿。

---

## 功能概览

| 模块 | 核心能力 |
|---|---|
| **多数据源** | SQLite / MySQL / PostgreSQL / ClickHouse / Spark(v1 Mock)，统一 `DataSourceProvider` 接口，Schema 内省 + TTL 缓存 |
| **语义层** | YAML 声明式 entities/terms/metrics，`fs.watch` + 防抖热加载，业务口径叠加进 `inspect_schema`，支持 `query_metric` 受治理 SQL 生成 |
| **text2SQL** | `node-sql-parser` 解析级白名单（仅单条 SELECT/WITH），LIMIT 自动注入，语句级超时，行数硬上限，`approval` 审批门，`reason` 审计 |
| **统计分析** | `profile`（逐列画像）/ `topn`（Top-N）/ `correlation`（Pearson 相关）/ `distribution`（直方图分箱） |
| **可视化** | Apache ECharts 6，六种图型（line/bar/pie/scatter/heatmap/KPI），Host 侧构建完整 option，SVG 渲染，重启后持久化重放 |
| **导出** | 单图自包含 HTML（离线交互）、PNG(2x)、CSV、`/data-dashboard` 仪表板、`/data-csv` 数据导出 |
| **命令** | `/data-sources` `/data-test` `/data-schema` `/data-sql` `/data-dashboard` `/data-csv` `/data-reload` |
| **安全** | `!!js process.env.*` 注入，密码 `role: 'secret'` 不回显，Web 工作台保存即热生效 |

---

## 快速开始

```sh
# 1. 依赖 + 链接本地 dsh checkout（运行时单例一致）
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
| `npm run typecheck` | TypeScript 类型检查 |

### 纯 Host 用法（不需要 UI）

`--patch` overlay 直接指向 `lib/index.js` 绝对路径即可（参考 `dev/cordis.overlay.yml`）。

---

## 配置

### 插件配置

```yaml
- id: rd-data-analysis
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

参考 `demo/semantic.yaml`：

```yaml
defaults:
  datasource: demo
entities:
  - table: orders
    label: 订单表
    columns:
      - { name: amount, label: 订单金额, unit: 元 }
terms:
  - name: GMV
    aliases: [成交总额]
    description: 已支付订单金额总和
metrics:
  - name: daily_revenue
    label: 每日收入
    entity: orders
    measure: amount
    agg: sum
    formula: SUM(amount) WHERE status = 'paid',按 created_at 分日
    grain: 按天
    timeField: created_at
    dimensions: [status, user_id]
    filters: ["status = 'paid'"]
    unit: 元
```

---

## 架构

```
┌─ Host 半 (src/index.ts → lib/index.js) ─────────────────────────┐
│ DataSourceRegistry                                                │
│   ├ sqlite(node:sqlite)   ├ mysql(mysql2)                       │
│   ├ postgres(pg)          ├ spark(seam + Mock)                   │
│ tools: list_data_sources / inspect_schema / run_sql /            │
│        render_chart / analyze_data                               │
│ sql/guard.ts: 解析级白名单 + LIMIT 注入                           │
│ approval.ts: 按数据源 ask/auto                                   │
│ charts/echarts-option.ts: 意图 → 完整 ECharts option             │
│ commands: /data-*  |  prompt.ts: 工作流节                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ tool/result (presentationMeta)
┌─ Browser 半 (src/client/ → lib/client.js) ──────────────────────┐
│ rdChartDefinition: match tool/result → 节点（幂等 chartId）       │
│ RdChartNodeView: ECharts SVG + 导出 HTML/PNG/CSV + 复制 SQL     │
│ export-html.ts: 自包含离线单文件（内联 echarts UMD）             │
└──────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

- **不发明自定义会话事件类型**：dsh 会话持久化按"已知事件目录"校验，out-of-tree 类型若无 `ignorable` 标记会导致整条日志被拒读。因此图表载荷挂在 `tool/result` 的 `presentationMeta` 上——同样持久、可重放、对任何构建安全。
- **`@deepseek-ai/*` 永远 external**：cordis DI / 工具注册表是宿主单例，打进包会出现第二实例破坏服务身份。
- **client 半是加载器的 lazy-CJS 工厂产物**：`window.__ModuleLoader__.load({id, factory})`，React 等平台模块走注入 require，ECharts 内联。

---

## Spark 真实接入路线（同一 `DataSourceProvider` seam）

1. **Apache Livy REST**（推荐起步）：纯 HTTP（`POST /sessions` → `/statements` → 轮询），Node 零原生依赖；结果为 JSON 文本，转 rows 即可。
2. **Spark Connect**（Spark 3.4+ 官方 gRPC）：Node 无成熟客户端，建议 Python sidecar（pyspark）经 localhost HTTP 桥或 `code-runtime-python` 线协议驱动。
3. **HiveServer2/Thrift**：遗留集群；Node Thrift 支持弱，同样建议 sidecar（pyhive）。

长查询务必走 `ctx.jobs.start` 异步任务 + 结果落地（Parquet/CSV），不要把大结果集回传对话。

---

## 验证矩阵

| 类别 | 覆盖内容 |
|---|---|
| **48 个单测/集成** | SQL guard 拒绝矩阵、LIMIT 注入、标识符注入、ECharts option 六图型、XSS 转义、CSV 转义、sqlite 端到端（执行/内省/四分析）、spark Mock、registry、语义层（YAML 校验拒绝矩阵/指标 SQL 构建/维度白名单/值转义/热加载容错/query_metric 端到端） |
| **真机（浏览器）** | 插件加载 → 真实对话（模型按注入工作流调用 list_data_sources → inspect_schema → run_sql → analyze_data → render_chart）→ 双数据源图表节点渲染（SQLite 171 天折线 + Spark Mock 环形图）→ 导出 HTML 离线打开可交互 → `/data-dashboard` 仪表板 → 服务重启后历史会话完整重放图表 → 语义层对话流（list_semantic → query_metric · daily_revenue → render_chart）→ 工作台卡片改配置保存 → settings user layer 持久化 + host 热重建 |

---

## 已知限制

- dsh 处于 developer preview，API 可能破坏性变更——本插件已锁定对接行为并附测试，升级需回归
- SQLite provider 同步执行（`node:sqlite`），超时不能中断运行中语句（行上限 + LIMIT 是有效约束）
- 会话内图表的内存注册表已移除，`/data-dashboard` 改从持久化日志读取（重启可用）
- PNG 导出依赖浏览器 canvas（KPI 卡无 PNG 按钮）
- Spark v1 为 Mock 数据，返回 canned 演示数据

---

## 目录结构

```
rd-data-agent/
├── package.json / cordis.patch.yml   # bundle 清单（dsh.bundle + dsh.client）
├── scripts/build.mjs                 # esbuild 双半构建（node ESM + client 工厂产物）
├── scripts/link-dsh.mjs              # dev:@deepseek-ai/* 符号链接到 dsh checkout
├── dev/cordis.overlay.yml            # 本地 --patch 联调 overlay（host-only）
├── demo/seed-demo.mjs                # 演示 SQLite 库
├── src/                              # host 半：config/registry/datasources/sql/schema/tools/commands/...
├── src/client/                       # browser 半：definition/ChartNodeView/export-html
├── src/shared/export-template.ts     # 两半共用的自包含 HTML 模板 + CSV
└── tests/                            # vitest：guard 矩阵 / option 构建 / sqlite e2e
```

---

## License

MIT
