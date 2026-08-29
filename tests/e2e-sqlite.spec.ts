/**
 * End-to-end over the real SQLite provider: guard → execute → cache →
 * introspection → analysis, plus the spark mock and registry behavior.
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { guardSelectOnly } from '../src/sql/guard.ts'
import { createSqliteProvider } from '../src/datasources/sqlite.ts'
import { createSparkMockProvider } from '../src/datasources/spark.ts'
import { DataSourceRegistry } from '../src/registry.ts'
import { correlation, distribution, profile, topn } from '../src/analysis/analyze.ts'

let provider: ReturnType<typeof createSqliteProvider>
let registry: DataSourceRegistry
const dbFile = join(tmpdir(), `rd-demo-${process.pid}.db`)

beforeAll(() => {
  const db = new DatabaseSync(dbFile)
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, city TEXT NOT NULL, age INTEGER NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  `)
  const insertUser = db.prepare('INSERT INTO users (id, city, age) VALUES (?, ?, ?)')
  const insertOrder = db.prepare('INSERT INTO orders (id, user_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)')
  for (let id = 1; id <= 50; id++) {
    insertUser.run(id, ['杭州', '上海', '北京'][id % 3], 20 + (id % 40))
    for (let k = 0; k < 4; k++) {
      const orderId = (id - 1) * 4 + k + 1
      insertOrder.run(orderId, id, 10 + ((orderId * 7) % 90), k === 0 ? 'paid' : 'pending', `2026-0${(k % 6) + 1}-15`)
    }
  }
  db.close()

  provider = createSqliteProvider('test-sqlite', dbFile)
  registry = new DataSourceRegistry(60_000, 60_000, 10)
  registry.register(provider)
})

afterAll(async () => {
  await registry.close()
})

describe('sqlite provider', () => {
  it('executes guarded SQL and flags a full page as possibly truncated', async () => {
    const guarded = guardSelectOnly('SELECT id, amount FROM orders ORDER BY id', 'sqlite', 10)
    const result = await provider.query(guarded.sql, { timeoutMs: 5000, maxRows: 10 })
    // The guard injected LIMIT 10; a full page means more rows may exist.
    expect(result.rowCount).toBe(10)
    expect(result.rows).toHaveLength(10)
    expect(result.truncated).toBe(true)
    expect(result.columns.map((col) => col.name)).toEqual(['id', 'amount'])
  })

  it('reports exact counts below the cap without truncation flags', async () => {
    const result = await provider.query('SELECT id FROM users LIMIT 7', { timeoutMs: 5000, maxRows: 10 })
    expect(result.rowCount).toBe(7)
    expect(result.truncated).toBe(false)
  })

  it('introspects tables and columns with samples', async () => {
    const schema = await provider.introspect({ includeSamples: true })
    const tables = schema.tables.map((table) => table.name)
    expect(tables).toContain('users')
    expect(tables).toContain('orders')
    const orders = schema.tables.find((table) => table.name === 'orders')
    expect(orders?.columns.map((col) => col.name)).toEqual(['id', 'user_id', 'amount', 'status', 'created_at'])
    expect(orders?.samples).toHaveLength(5)
  })
})

describe('registry', () => {
  it('caches results for render_chart references and evicts by TTL/size', async () => {
    registry.putResult({ resultId: 'r1', datasource: 'test-sqlite', dialect: 'sqlite', sql: 'SELECT 1', columns: [], rows: [{ a: 1 }], rowCount: 1, truncated: false })
    expect(registry.getResult('r1')?.rows).toEqual([{ a: 1 }])
    expect(registry.getResult('missing')).toBeUndefined()
  })

  it('extracts chart payloads from tool/result meta shapes', async () => {
    const { chartFromResultMeta } = await import('../src/events.ts')
    expect(chartFromResultMeta({ rdChart: { chartId: 'c1', echartsOption: {} } })?.chartId).toBe('c1')
    expect(chartFromResultMeta(undefined)).toBeUndefined()
    expect(chartFromResultMeta({ other: 1 })).toBeUndefined()
    expect(chartFromResultMeta({ rdChart: { nope: true } })).toBeUndefined()
  })
})

describe('analyses over the guarded base query', () => {
  const base = guardSelectOnly('SELECT * FROM orders', 'sqlite', 10_000).sql
  const ctx = {
    dialect: 'sqlite' as const,
    run: (sql: string) => provider.query(sql, { timeoutMs: 5000, maxRows: 20_000 }),
  }

  it('profile reports numeric stats and top values', async () => {
    const report = await profile(ctx, base) as { rowsAnalyzed: number, columns: { column: string, numeric?: { mean: number }, topValues?: unknown[] }[] }
    expect(report.rowsAnalyzed).toBe(200)
    const amount = report.columns.find((col) => col.column === 'amount')
    expect(amount?.numeric).toBeDefined()
    const status = report.columns.find((col) => col.column === 'status')
    expect(status?.topValues?.length).toBeGreaterThan(0)
  })

  it('topn groups by dimension', async () => {
    const report = await topn(ctx, base, { dimension: 'status', aggregate: 'count', topN: 5 })
    expect((report.rows as unknown[]).length).toBe(2)
  })

  it('correlation computes Pearson r', async () => {
    const report = await correlation(ctx, base, { column: 'id', column2: 'amount' })
    expect(Number.isFinite(report.pearsonR as number)).toBe(true)
  })

  it('distribution bins a numeric column', async () => {
    const report = await distribution(ctx, base, { column: 'amount', buckets: 6 })
    const bins = report.bins as { count: number }[]
    expect(bins).toHaveLength(6)
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(200)
  })

  it('rejects unsafe identifiers before SQL is built', async () => {
    await expect(topn(ctx, base, { dimension: 'status; DROP TABLE orders' })).rejects.toThrow()
  })
})

describe('spark mock provider', () => {
  it('simulates latency, reports mock, and serves canned aggregates', async () => {
    const spark = createSparkMockProvider('spark-demo', 20)
    expect(spark.mock).toBe(true)
    const result = await spark.query('SELECT dt, revenue FROM daily_revenue', { timeoutMs: 5000, maxRows: 20 })
    expect(result.rowCount).toBe(14)
    expect(result.columns.map((col) => col.name)).toEqual(['dt', 'revenue', 'orders'])
  })

  it('introspects the canned schema', async () => {
    const spark = createSparkMockProvider('spark-demo', 1)
    const schema = await spark.introspect()
    expect(schema.tables.map((table) => table.name)).toEqual(['orders', 'daily_revenue', 'users'])
  })
})
