/**
 * Semantic layer composition tests: `include` splitting, three-axis
 * inheritance (defaults → entity → extends), the post-load lint pass, and
 * hot reload across the whole include graph.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadSemanticGraph, parseSemanticConfig, SemanticConfigError } from '../src/semantic/load.ts'
import { formatLintIssue, lintSemanticConfig } from '../src/semantic/lint.ts'
import { SemanticLayer } from '../src/semantic/layer.ts'
import type { LintCode, SemanticConfig } from '../src/semantic/types.ts'
import { createSqliteProvider } from '../src/datasources/sqlite.ts'
import { DataSourceRegistry } from '../src/registry.ts'
import { guardSelectOnly } from '../src/sql/guard.ts'

/** Write a whole file tree into a temp dir; returns its root. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sem-compose-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = join(dir, relative)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const codes = (config: SemanticConfig): LintCode[] => lintSemanticConfig(config).map((issue) => issue.code)

/**
 * Poll for a hot-reload side effect. The budget is deliberately generous:
 * fs.watch delivery on macOS (FSEvents) is not bounded, and a loaded CI box
 * or a parallel build can push a `create` event well past a second. Flaky
 * tests cost more than the extra idle milliseconds.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timeout waiting for condition')
}

describe('include: 拆分语义层配置', () => {
  it('按 include 顺序合并,根目录的定义最后生效', () => {
    const dir = tree({
      'semantic.yaml': 'include:\n  - ./parts/*.yaml\ndefaults:\n  datasource: demo\n',
      'parts/01-entities.yaml': 'entities:\n  - table: orders\n    label: 订单表\n',
      'parts/02-terms.yaml': 'terms:\n  - name: GMV\n    description: 成交总额\n',
      'parts/03-metrics.yaml': 'metrics:\n  - name: daily_orders\n    label: 每日订单量\n    entity: orders\n    agg: count\n',
    })
    const { config, files } = loadSemanticGraph(join(dir, 'semantic.yaml'))
    expect(config.defaults?.datasource).toBe('demo')
    expect(config.entities).toHaveLength(1)
    expect(config.terms).toHaveLength(1)
    expect(config.metrics).toHaveLength(1)
    // Root last: parts first (sorted), then the root itself.
    expect(files.map((file) => file.slice(dir.length + 1))).toEqual([
      'parts/01-entities.yaml', 'parts/02-terms.yaml', 'parts/03-metrics.yaml', 'semantic.yaml',
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  it('支持目录简写与递归 glob (**)', () => {
    const dir = tree({
      'semantic.yaml': 'include:\n  - ./entities\n  - ./domains/**/*.yaml\n',
      'entities/users.yaml': 'entities:\n  - table: users\n',
      'entities/notes.txt': 'ignored',
      'domains/orders/entities.yaml': 'entities:\n  - table: orders\n',
      'domains/orders/metrics.yaml': 'metrics:\n  - name: order_count\n    entity: orders\n    agg: count\n',
      'domains/billing/index.yaml': 'entities:\n  - table: invoices\n',
    })
    const { config, files } = loadSemanticGraph(join(dir, 'semantic.yaml'))
    expect(config.entities?.map((entity) => entity.table).sort()).toEqual(['invoices', 'orders', 'users'])
    expect(config.metrics).toHaveLength(1)
    expect(files).toHaveLength(5) // entities/users.yaml + 3 domain files + root
    rmSync(dir, { recursive: true, force: true })
  })

  it('include 成环不会死循环,每个文件只贡献一次', () => {
    const dir = tree({
      'a.yaml': 'include: ./b.yaml\nentities:\n  - table: orders\n',
      'b.yaml': 'include: ./a.yaml\nmetrics:\n  - name: order_count\n    label: 订单数\n    entity: orders\n    agg: count\n',
    })
    const { config, files } = loadSemanticGraph(join(dir, 'a.yaml'))
    expect(config.entities).toHaveLength(1)
    expect(config.metrics).toHaveLength(1)
    expect(files).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('include 匹配不到文件时报错并指明来源,不静默丢掉半个目录', () => {
    const dir = tree({
      'semantic.yaml': 'include:\n  - ./metrics/*.yaml\n',
      'metrics/.keep': '',
    })
    expect(() => loadSemanticGraph(join(dir, 'semantic.yaml'))).toThrow(/未匹配到任何文件/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('parseSemanticConfig 用 dir 选项解析相对 include', () => {
    const dir = tree({
      'parts/entities.yaml': 'entities:\n  - table: orders\n',
    })
    const config = parseSemanticConfig('include: ./parts/entities.yaml\n', { dir })
    expect(config.entities?.map((entity) => entity.table)).toEqual(['orders'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('重复定义以最后加载的文件为准,并给出 duplicate-definition 提示', () => {
    const dir = tree({
      'semantic.yaml': 'include:\n  - ./base.yaml\nentities:\n  - table: orders\n    label: 覆盖后的标签\n',
      'base.yaml': 'entities:\n  - table: orders\n    label: 被覆盖的标签\n',
    })
    const { config, issues } = loadSemanticGraph(join(dir, 'semantic.yaml'))
    expect(config.entities).toHaveLength(1)
    expect(config.entities?.[0].label).toBe('覆盖后的标签')
    const dup = issues.find((issue) => issue.code === 'duplicate-definition')
    expect(dup).toBeDefined()
    expect(formatLintIssue(dup!, 'zh').message).toContain('base.yaml')
    // 路径里的集合名要拼对:entities / terms / metrics
    expect(dup!.path).toMatch(/entities\["orders"\]$/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('继承: defaults → entity → extends → metric', () => {
  const ENTITIES = `entities:
  - table: orders
    timeField: created_at
    dimensions: [status, city]
    filters: ["deleted = 0"]
    columns:
      - { name: amount, label: 金额 }
      - { name: status, label: 状态 }
      - { name: city, label: 城市 }
      - { name: created_at, label: 下单时间 }
`

  it('metric 未声明时继承 entity 的 timeField 与 dimensions', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: revenue
    label: 收入
    entity: orders
    measure: amount
    agg: sum
`)
    const metric = config.metrics?.[0]
    expect(metric?.timeField).toBe('created_at')
    expect(metric?.dimensions).toEqual(['status', 'city'])
    // entity 的固定过滤条件也被继承下来
    expect(metric?.filters).toEqual(['deleted = 0'])
  })

  it('metric 自己的声明覆盖 entity 默认', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: revenue
    label: 收入
    entity: orders
    measure: amount
    agg: sum
    timeField: paid_at
    dimensions: [city]
`)
    const metric = config.metrics?.[0]
    expect(metric?.timeField).toBe('paid_at')
    expect(metric?.dimensions).toEqual(['city'])
  })

  it('defaults 向所有 entity/metric 兜底', () => {
    const config = parseSemanticConfig(`defaults:
  datasource: demo
  timeField: dt
  dimensions: [tenant]
  filters: ["tenant <> 'internal'"]
entities:
  - table: events
    columns:
      - { name: dt }
      - { name: tenant }
metrics:
  - name: event_count
    label: 事件数
    entity: events
    agg: count
`)
    const metric = config.metrics?.[0]
    expect(metric?.timeField).toBe('dt')
    expect(metric?.dimensions).toEqual(['tenant'])
    expect(metric?.filters).toEqual(["tenant <> 'internal'"])
  })

  it('extends 继承 entity/measure/agg,filters 逐级累加且去重', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: paid_amount
    label: 已支付金额
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]
    unit: 元
  - name: daily_paid_amount
    extends: paid_amount
    label: 每日已支付金额
    filters: ["status = 'paid'", "amount > 0"]
`)
    const child = config.metrics?.find((metric) => metric.name === 'daily_paid_amount')
    expect(child?.entity).toBe('orders')
    expect(child?.measure).toBe('amount')
    expect(child?.agg).toBe('sum')
    expect(child?.unit).toBe('元')
    expect(child?.timeField).toBe('created_at')
    // entity ++ base ++ child,重复的 status 谓词只保留一个
    expect(child?.filters).toEqual(['deleted = 0', "status = 'paid'", 'amount > 0'])
    // extends 被解析掉,下游拿到的都是自包含的指标
    expect(child?.extends).toBeUndefined()
  })

  it('extends 可以只改一个字段(换 agg / 换 measure)', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: paid_amount
    label: 已支付金额
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]
  - name: avg_paid_amount
    extends: paid_amount
    label: 客单价
    agg: avg
  - name: paying_users
    extends: paid_amount
    label: 支付用户数
    measure: user_id
    agg: count_distinct
`)
    const avg = config.metrics?.find((metric) => metric.name === 'avg_paid_amount')
    expect(avg?.agg).toBe('avg')
    expect(avg?.measure).toBe('amount')
    expect(avg?.filters).toEqual(['deleted = 0', "status = 'paid'"])

    const users = config.metrics?.find((metric) => metric.name === 'paying_users')
    expect(users?.agg).toBe('count_distinct')
    expect(users?.measure).toBe('user_id')
    expect(users?.entity).toBe('orders')
  })

  it('多层 extends 链按 root → child 顺序累加', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: base
    label: 基础
    entity: orders
    measure: amount
    agg: sum
    filters: ["a = 1"]
  - name: middle
    extends: base
    filters: ["b = 2"]
  - name: leaf
    extends: middle
    label: 叶子
    filters: ["c = 3"]
`)
    const leaf = config.metrics?.find((metric) => metric.name === 'leaf')
    expect(leaf?.filters).toEqual(['deleted = 0', 'a = 1', 'b = 2', 'c = 3'])
  })

  it('extends 未知 base / 成环 / 链上缺 agg 都直接报错', () => {
    expect(() => parseSemanticConfig(`${ENTITIES}metrics:
  - name: x
    extends: nope
`)).toThrow(/extends "nope" 未定义/)

    expect(() => parseSemanticConfig(`${ENTITIES}metrics:
  - name: a
    extends: b
  - name: b
    extends: a
`)).toThrow(/继承链成环/)

    // 继承链的根(没有 extends 的那一个)必须自己声明 entity/agg;
    // 链上缺 measure 则在组合阶段才暴露。
    expect(() => parseSemanticConfig(`${ENTITIES}metrics:
  - name: base
    entity: orders
    agg: sum
  - name: child
    extends: base
`)).toThrow(/需要 measure/)
  })

  it('没有 extends 时 entity/agg 仍为必填', () => {
    expect(() => parseSemanticConfig(`${ENTITIES}metrics:\n  - name: x\n    measure: amount\n`)).toThrow(SemanticConfigError)
    expect(() => parseSemanticConfig(`${ENTITIES}metrics:\n  - name: x\n    entity: orders\n    measure: amount\n`)).toThrow(/agg is required/)
  })
})

describe('lint: 语义体检(warning,不阻塞)', () => {
  const ENTITIES = `entities:
  - table: orders
    label: 订单表
    columns:
      - { name: amount, label: 金额 }
      - { name: status, label: 状态 }
      - { name: created_at, label: 下单时间 }
`

  it('维度未在 entity.columns 中声明', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: revenue
    label: 收入
    entity: orders
    measure: amount
    agg: sum
    dimensions: [status, city]
`)
    const issue = lintSemanticConfig(config).find((entry) => entry.code === 'unknown-dimension-column')
    expect(issue).toBeDefined()
    expect(formatLintIssue(issue!, 'zh').message).toContain('"city"')
    expect(issue?.path).toContain('metrics["revenue"].dimensions')
  })

  it('度量列 / 时间列未声明,维度重复,count 带 measure', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: a
    label: A
    entity: orders
    measure: revenue
    agg: sum
    timeField: paid_at
    dimensions: [status, status]
  - name: b
    label: B
    entity: orders
    measure: amount
    agg: count
`)
    expect(codes(config)).toEqual(expect.arrayContaining([
      'unknown-measure-column', 'unknown-timefield-column', 'duplicate-dimension', 'count-with-measure',
    ]))
  })

  it('术语别名冲突与指标名遮蔽术语', () => {
    const config = parseSemanticConfig(`${ENTITIES}terms:
  - name: GMV
    aliases: [成交额]
    description: 成交总额
  - name: 销售额
    aliases: [成交额]
    description: 另一个口径
metrics:
  - name: GMV
    label: GMV
    entity: orders
    measure: amount
    agg: sum
`)
    expect(codes(config)).toEqual(expect.arrayContaining(['term-alias-collision', 'metric-shadows-term']))
  })

  it('既无 timeField 又无 filters 的全表聚合指标', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: everything
    label: 全表
    entity: orders
    measure: amount
    agg: sum
`)
    expect(codes(config)).toContain('unbounded-metric')
    // 加上固定过滤条件后不再告警
    const fixed = parseSemanticConfig(`${ENTITIES}metrics:
  - name: everything
    label: 全表
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]
`)
    expect(codes(fixed)).not.toContain('unbounded-metric')
  })

  it('缺 label 汇总成一条', () => {
    const config = parseSemanticConfig(`${ENTITIES}metrics:
  - name: a
    entity: orders
    measure: amount
    agg: sum
    timeField: created_at
  - name: b
    entity: orders
    measure: amount
    agg: sum
    timeField: created_at
`)
    const issues = lintSemanticConfig(config)
    expect(issues.filter((issue) => issue.code === 'missing-label')).toHaveLength(1)
    expect(formatLintIssue(issues.find((issue) => issue.code === 'missing-label')!, 'zh').message).toContain('2 个指标')
  })

  it('有告警也照常加载:告警不阻塞', () => {
    const dir = tree({
      'semantic.yaml': `${ENTITIES}metrics:
  - name: revenue
    label: 收入
    entity: orders
    measure: amount
    agg: sum
    dimensions: [city]
`,
    })
    const { config, issues } = loadSemanticGraph(join(dir, 'semantic.yaml'))
    expect(issues.length).toBeGreaterThan(0)
    expect(config.metrics).toHaveLength(1)
    expect(config.metrics?.[0].dimensions).toEqual(['city'])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('热加载覆盖 include 全图', () => {
  it('修改被 include 的文件也会触发重载', async () => {
    const dir = tree({
      'semantic.yaml': 'include:\n  - ./parts/*.yaml\n',
      'parts/entities.yaml': 'entities:\n  - table: orders\n    label: 订单表\n    columns:\n      - { name: amount }\n',
      'parts/metrics.yaml': 'metrics:\n  - name: revenue\n    label: 收入\n    entity: orders\n    measure: amount\n    agg: sum\n    timeField: created_at\n',
    })
    const layer = new SemanticLayer(join(dir, 'semantic.yaml'))
    expect(layer.watchedFiles).toHaveLength(3)

    // 新增一个被 glob 覆盖的文件:重载后指标数应变 2,监听集合也要跟着变
    writeFileSync(join(dir, 'parts/extra.yaml'), 'metrics:\n  - name: orders_count\n    label: 订单数\n    entity: orders\n    agg: count\n')
    try {
      await waitFor(() => layer.get().metrics?.length === 2)
    } catch (error) {
      // Diagnostics: distinguish "event never fired" from "reload ran but failed".
      throw new Error(`${(error as Error).message}; metrics=${layer.get().metrics?.length} watched=${layer.watchedFiles.length} error=${layer.error ?? 'none'}`)
    }
    expect(layer.watchedFiles).toHaveLength(4)

    // 改现有文件:标签随之更新
    writeFileSync(join(dir, 'parts/entities.yaml'), 'entities:\n  - table: orders\n    label: 订单表(已更新)\n    columns:\n      - { name: amount }\n')
    await waitFor(() => layer.entityFor('orders')?.label === '订单表(已更新)')

    // 改坏:保留上一次有效配置并上报错误
    writeFileSync(join(dir, 'parts/entities.yaml'), 'entities: { not: [valid')
    await waitFor(() => layer.error !== undefined)
    expect(layer.get().entities?.[0].label).toBe('订单表(已更新)')

    layer.dispose()
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})

describe('demo/semantic.yaml', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '..', 'demo', 'semantic.yaml')
  const dbFile = join(here, '..', 'demo', 'demo.db')
  const { config, issues, files } = loadSemanticGraph(root)

  it('include 展开出 4 个文件', () => {
    expect(files).toHaveLength(4)
    expect(config.entities?.map((entity) => entity.table)).toEqual(['orders', 'users', 'daily_revenue'])
    expect(config.terms).toHaveLength(2)
  })

  it('继承与 extends 生效', () => {
    const gmv = config.metrics?.find((metric) => metric.name === 'gmv_total')
    expect(gmv?.entity).toBe('orders')
    expect(gmv?.measure).toBe('amount')
    expect(gmv?.agg).toBe('sum')
    expect(gmv?.filters).toEqual(["status = 'paid'"])
    // entity orders 刻意不设 timeField,单值 KPI 才不会被按天分组
    expect(gmv?.timeField).toBeUndefined()

    const avg = config.metrics?.find((metric) => metric.name === 'avg_order_value')
    expect(avg?.agg).toBe('avg')
    expect(avg?.filters).toEqual(["status = 'paid'"])

    const paying = config.metrics?.find((metric) => metric.name === 'paying_users')
    expect(paying?.agg).toBe('count_distinct')
    expect(paying?.measure).toBe('user_id')

    // 时间列从 entity daily_revenue.timeField 继承
    const agg = config.metrics?.find((metric) => metric.name === 'agg_daily_revenue')
    expect(agg?.timeField).toBe('dt')
    expect(agg?.entity).toBe('daily_revenue')

    // 不继承 paid 口径的指标保持全状态
    const orders = config.metrics?.find((metric) => metric.name === 'daily_orders')
    expect(orders?.filters).toBeUndefined()
  })

  it('体检无告警', () => {
    expect(issues).toEqual([])
  })

  it('组合后的配置能跑通真实 SQL(继承来的口径真的生效)', async () => {
    const provider = createSqliteProvider('demo', dbFile)
    const registry = new DataSourceRegistry(60_000, 60_000, 10)
    registry.register(provider)
    const layer = new SemanticLayer(root)
    try {
      // 时间列 + filters 都来自继承/基础口径:SQL 里必须带上 status = 'paid'
      const daily = layer.buildMetricSql('daily_revenue', { from: '2026-01-01', to: '2026-12-31' }, provider.dialect)
      expect(daily.sql).toContain("WHERE status = 'paid'")
      expect(daily.sql).toContain('GROUP BY orders."created_at"')
      const rows = await provider.query(guardSelectOnly(daily.sql, provider.dialect, 500).sql, { timeoutMs: 5000, maxRows: 500 })
      expect(rows.rowCount).toBeGreaterThan(0)

      // 单值 KPI:继承不到时间列 → 不分组
      const gmv = layer.buildMetricSql('gmv_total', {}, provider.dialect)
      expect(gmv.sql).not.toContain('GROUP BY')
      const total = await provider.query(guardSelectOnly(gmv.sql, provider.dialect, 500).sql, { timeoutMs: 5000, maxRows: 500 })
      expect(total.rowCount).toBe(1)

      // 预聚合表:时间列继承自 entity daily_revenue.timeField
      const agg = layer.buildMetricSql('agg_daily_revenue', {}, provider.dialect)
      expect(agg.sql).toContain('GROUP BY daily_revenue."dt"')
      const aggRows = await provider.query(guardSelectOnly(agg.sql, provider.dialect, 500).sql, { timeoutMs: 5000, maxRows: 500 })
      expect(aggRows.rowCount).toBeGreaterThan(0)
    } finally {
      layer.dispose()
      await registry.close()
    }
  })
})
