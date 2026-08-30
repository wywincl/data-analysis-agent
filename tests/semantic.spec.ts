/**
 * Semantic layer tests: YAML validation, metric → SQL building, hot reload,
 * and end-to-end query_metric flow over the demo-shaped SQLite provider.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseSemanticConfig, SemanticConfigError, loadSemanticFile } from '../src/semantic/load.ts'
import { SemanticLayer, sqlLiteral } from '../src/semantic/layer.ts'
import { createSqliteProvider } from '../src/datasources/sqlite.ts'
import { DataSourceRegistry } from '../src/registry.ts'
import { guardSelectOnly } from '../src/sql/guard.ts'

const YAML = `
defaults:
  datasource: demo
entities:
  - table: orders
    label: 订单表
    description: 订单事实表,一行一笔订单
    columns:
      - { name: amount, label: 订单金额, unit: 元 }
      - { name: status, label: 订单状态 }
  - datasource: warehouse
    table: dws_sales
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
    formula: SUM(amount) WHERE status='paid'
    timeField: created_at
    dimensions: [status, city]
    filters: ["status = 'paid'"]
    unit: 元
  - name: order_count
    entity: orders
    agg: count
    timeField: created_at
  - name: paying_users
    entity: orders
    measure: user_id
    agg: count_distinct
    timeField: created_at
`

describe('parseSemanticConfig', () => {
  it('parses the full document', () => {
    const config = parseSemanticConfig(YAML)
    expect(config.defaults?.datasource).toBe('demo')
    expect(config.entities).toHaveLength(2)
    expect(config.metrics).toHaveLength(3)
    expect(config.terms?.[0].aliases).toEqual(['成交总额'])
  })

  it('rejects unknown metric entity, bad agg, injection identifiers, and missing measure', () => {
    expect(() => parseSemanticConfig('metrics:\n  - name: x\n    entity: nope\n    agg: sum\n    measure: a')).toThrow(SemanticConfigError)
    expect(() => parseSemanticConfig('metrics:\n  - name: x\n    entity: orders\n    agg: median')).toThrow(/agg/)
    expect(() => parseSemanticConfig('entities:\n  - table: orders\nmetrics:\n  - name: x\n    entity: orders\n    agg: sum\n    measure: "a; DROP"')).toThrow(/identifier/)
    expect(() => parseSemanticConfig('entities:\n  - table: orders\nmetrics:\n  - name: x\n    entity: orders\n    agg: sum')).toThrow(/measure/)
    expect(() => parseSemanticConfig('entities:\n  - table: "a; b"')).toThrow(/identifier/)
    expect(() => parseSemanticConfig('{[[')).toThrow(/parse/)
  })
})

describe('SemanticLayer.buildMetricSql', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sem-'))
  const file = join(dir, 'semantic.yaml')
  writeFileSync(file, YAML)
  const layer = new SemanticLayer(file)

  it('time series default: group by timeField', () => {
    const built = layer.buildMetricSql('daily_revenue', {}, 'sqlite')
    expect(built.sql).toContain('SELECT orders."created_at" AS "created_at", SUM(orders."amount") AS "value"')
    expect(built.sql).toContain('FROM "orders" AS orders')
    expect(built.sql).toContain("WHERE status = 'paid'")
    expect(built.sql).toContain('GROUP BY orders."created_at"')
    expect(built.datasource).toBe('demo')
  })

  it('dimensions + filters + time range, identifiers quoted, values escaped', () => {
    const built = layer.buildMetricSql('daily_revenue', {
      dimensions: ['status', 'city'],
      filters: { city: "杭州'; DROP TABLE orders--" },
      from: '2026-03-01',
      to: '2026-03-31',
    }, 'mysql')
    expect(built.sql).toContain('orders.`status` AS `status`')
    expect(built.sql).toContain("orders.`city` = '杭州''; DROP TABLE orders--'")
    expect(built.sql).toContain("orders.`created_at` >= '2026-03-01'")
    expect(built.sql).toContain('GROUP BY orders.`status`, orders.`city`')
    expect(built.sql).toContain('ORDER BY value DESC')
  })

  it('undeclared dimension and filter key are rejected', () => {
    expect(() => layer.buildMetricSql('daily_revenue', { dimensions: ['amount'] })).toThrow(/not declared/)
    expect(() => layer.buildMetricSql('daily_revenue', { filters: { amount: 1 } })).toThrow(/declared dimension/)
  })

  it('count uses *, count_distinct uses DISTINCT', () => {
    expect(layer.buildMetricSql('order_count', {}, 'sqlite').sql).toContain('COUNT(*)')
    expect(layer.buildMetricSql('paying_users', {}, 'sqlite').sql).toContain('COUNT(DISTINCT orders."user_id")')
  })

  it('catalog + promptDigest + entityFor expose the governed layer', () => {
    const catalog = layer.catalog()
    expect(catalog.metrics).toHaveLength(3)
    expect(catalog.metrics[0].resolvedDatasource).toBe('demo')
    expect(catalog.entities[0].label).toBe('订单表')
    expect(layer.promptDigest()).toContain('GMV')
    expect(layer.entityFor('orders')?.columns?.[0].label).toBe('订单金额')
  })

  it('a broken file keeps the last good config and surfaces the error', () => {
    writeFileSync(file, 'metrics: { not: [valid')
    layer.reload()
    expect(layer.error).toBeDefined()
    expect(layer.catalog().metrics).toHaveLength(3)
    writeFileSync(file, YAML)
    layer.reload()
    expect(layer.error).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  it('loadSemanticFile reads from disk', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'sem2-'))
    const file2 = join(dir2, 's.yaml')
    writeFileSync(file2, YAML)
    expect(loadSemanticFile(file2).metrics).toHaveLength(3)
    rmSync(dir2, { recursive: true, force: true })
  })
})

describe('sqlLiteral', () => {
  it('numbers raw, booleans per dialect, strings escaped', () => {
    expect(sqlLiteral(42, 'sqlite')).toBe('42')
    expect(sqlLiteral(true, 'sqlite')).toBe('1')
    expect(sqlLiteral(true, 'postgresql')).toBe('true')
    expect(sqlLiteral("o'brien", 'mysql')).toBe("'o''brien'")
  })
})

describe('query_metric flow end-to-end over sqlite', () => {
  let provider: ReturnType<typeof createSqliteProvider>
  let registry: DataSourceRegistry
  const dbFile = join(tmpdir(), `rd-sem-${process.pid}.db`)

  beforeAll(() => {
    const db = new DatabaseSync(dbFile)
    db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, status TEXT, city TEXT, created_at TEXT)')
    const insert = db.prepare('INSERT INTO orders (user_id, amount, status, city, created_at) VALUES (?, ?, ?, ?, ?)')
    for (let day = 1; day <= 5; day++) {
      for (let index = 0; index < 10; index++) {
        insert.run(index, 100 + day * 10 + index, index % 2 === 0 ? 'paid' : 'refunded', index % 2 === 0 ? '杭州' : '上海', `2026-03-0${day}`)
      }
    }
    db.close()
    provider = createSqliteProvider('demo', dbFile)
    registry = new DataSourceRegistry(60_000, 60_000, 10)
    registry.register(provider)
  })

  afterAll(async () => {
    await registry.close()
    rmSync(dbFile, { force: true })
  })

  it('builds, guards, executes, and caches a governed metric query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sem3-'))
    const file = join(dir, 'semantic.yaml')
    writeFileSync(file, YAML)
    const layer = new SemanticLayer(file)
    const built = layer.buildMetricSql('daily_revenue', { from: '2026-03-01', to: '2026-03-31' }, provider.dialect)
    const guarded = guardSelectOnly(built.sql, provider.dialect, 500)
    const result = await provider.query(guarded.sql, { timeoutMs: 5000, maxRows: 500 })
    // 5 days, paid rows only (even indices) — one row per day.
    expect(result.rowCount).toBe(5)
    const values = result.rows.map((row) => row.value) as number[]
    // Day 1 paid amounts: 100+10*1+{0,2,4,6,8} = 110,130,140,160,180 → wait:
    // amount = 100 + day*10 + index; paid when index even → indices 0,2,4,6,8.
    expect(values[0]).toBe(100 + 10 * 1 + 0 + 100 + 10 * 1 + 2 + 100 + 10 * 1 + 4 + 100 + 10 * 1 + 6 + 100 + 10 * 1 + 8)
    registry.putResult({ resultId: 'm1', datasource: 'demo', dialect: 'sqlite', sql: guarded.sql, columns: result.columns, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated })
    expect(registry.getResult('m1')?.rowCount).toBe(5)
    rmSync(dir, { recursive: true, force: true })
  })
})
