/**
 * Automatic chart-type inference and the `insight` analysis.
 *
 * `autoChartType` is pure host-side shape inspection — these tests pin the
 * decision table so a model asking for chartType "auto" gets a stable result.
 * `insight` runs over a real seeded SQLite database to prove the derived SQL,
 * shares, trend and outlier maths agree with hand-computed values.
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSqliteProvider } from '../src/datasources/sqlite.ts'
import { autoChartType, buildEchartsOption } from '../src/charts/echarts-option.ts'
import { insight, type AnalysisContext } from '../src/analysis/analyze.ts'
import type { JsonValue } from '../src/types.ts'

type Row = Record<string, JsonValue>

describe('autoChartType', () => {
  it('picks kpi for a single row carrying one number', () => {
    expect(autoChartType({ data: [{ label: 'revenue', value: 1234 }] })).toBe('kpi')
  })

  it('picks line for a time-like x axis', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, revenue: 100 + i * 10 }))
    expect(autoChartType({ data })).toBe('line')
  })

  it('picks bar for many categorical rows (ranking, not composition)', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ region: `r${i}`, value: i * 3 }))
    expect(autoChartType({ data })).toBe('bar')
  })

  it('picks pie for a few unique non-negative categories', () => {
    const data = [
      { channel: 'web', value: 40 },
      { channel: 'app', value: 30 },
      { channel: 'mini', value: 20 },
      { channel: 'h5', value: 10 },
    ]
    expect(autoChartType({ data })).toBe('pie')
  })

  it('does not pick pie when any value is negative', () => {
    const data = [{ channel: 'web', value: 40 }, { channel: 'app', value: -30 }]
    expect(autoChartType({ data })).toBe('bar')
  })

  it('picks scatter for two numeric columns with enough points', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i * i }))
    expect(autoChartType({ data })).toBe('scatter')
  })

  it('picks heatmap for two category columns plus one measure', () => {
    const data = [
      { region: 'east', product: 'a', sales: 1 },
      { region: 'east', product: 'b', sales: 2 },
      { region: 'west', product: 'a', sales: 3 },
      { region: 'west', product: 'b', sales: 4 },
      { region: 'north', product: 'a', sales: 5 },
      { region: 'north', product: 'b', sales: 6 },
    ]
    expect(autoChartType({ data })).toBe('heatmap')
  })

  it('honours an explicit xField and series selection', () => {
    const data = Array.from({ length: 6 }, (_, i) => ({ region: `r${i}`, a: i, b: i * 2 }))
    // Two value columns requested → not a parts-of-whole, and no second category.
    expect(autoChartType({ data, xField: 'region', series: [{ field: 'a' }, { field: 'b' }] })).toBe('bar')
  })

  it('falls back to bar for empty data', () => {
    expect(autoChartType({ data: [] })).toBe('bar')
  })
})

describe('buildEchartsOption — boxplot and funnel', () => {
  it('groups raw values by category and emits five-number summaries', () => {
    const data: Row[] = [
      { cat: 'A', v: 1 }, { cat: 'A', v: 2 }, { cat: 'A', v: 3 }, { cat: 'A', v: 4 },
      { cat: 'B', v: 10 }, { cat: 'B', v: 20 },
    ]
    const option = buildEchartsOption({ chartType: 'boxplot', title: 'Spread', data, xField: 'cat', series: [{ field: 'v' }] })
    const series = (option.series as { type: string, data: number[][] }[])[0]
    expect(series.type).toBe('boxplot')
    expect(option.xAxis).toEqual({ type: 'category', data: ['A', 'B'] })
    // A: [1,2,3,4] → min 1, Q1 1.75, median 2.5, Q3 3.25, max 4
    expect(series.data[0]).toEqual([1, 1.75, 2.5, 3.25, 4])
    // B: [10,20] → min 10, Q1 12.5, median 15, Q3 17.5, max 20
    expect(series.data[1]).toEqual([10, 12.5, 15, 17.5, 20])
  })

  it('maps name/value pairs onto funnel stages', () => {
    const data: Row[] = [{ stage: 'visit', n: 100 }, { stage: 'cart', n: 40 }, { stage: 'pay', n: 10 }]
    const option = buildEchartsOption({ chartType: 'funnel', title: 'Funnel', data, nameField: 'stage', valueField: 'n' })
    const series = (option.series as { type: string, data: { name: string, value: number }[] }[])[0]
    expect(series.type).toBe('funnel')
    expect(series.data).toEqual([
      { name: 'visit', value: 100 },
      { name: 'cart', value: 40 },
      { name: 'pay', value: 10 },
    ])
  })
})

describe('insight over SQLite', () => {
  const dbFile = join(tmpdir(), `rd-insight-${process.pid}.db`)
  let provider: ReturnType<typeof createSqliteProvider>
  let ctx: AnalysisContext

  beforeAll(() => {
    const db = new DatabaseSync(dbFile)
    db.exec('CREATE TABLE sales (day TEXT NOT NULL, region TEXT NOT NULL, amount REAL NOT NULL)')
    const insert = db.prepare('INSERT INTO sales (day, region, amount) VALUES (?, ?, ?)')
    // Group sums: A = 60, B = 60, C = 540 (one 500 outlier); total 660.
    insert.run('2026-01-01', 'A', 10)
    insert.run('2026-01-02', 'A', 20)
    insert.run('2026-01-03', 'A', 30)
    insert.run('2026-01-04', 'B', 40)
    insert.run('2026-01-05', 'B', 20)
    insert.run('2026-01-06', 'C', 40)
    insert.run('2026-01-07', 'C', 500)
    db.close()

    provider = createSqliteProvider('insight-sqlite', dbFile)
    ctx = {
      dialect: 'sqlite',
      run: (sql) => provider.query(sql, { timeoutMs: 10_000, maxRows: 20_000 }),
    }
  })

  afterAll(async () => {
    await provider.close()
    rmSync(dbFile, { force: true })
  })

  it('reports headline stats, contributors, concentration and trend', async () => {
    const result = await insight(ctx, 'SELECT day, region, amount FROM sales ORDER BY day', { dimension: 'region', measure: 'amount' })

    expect(result.measure).toBe('amount')
    expect(result.dimension).toBe('region')

    const summary = result.summary as { rows: number, total: number, mean: number, median: number, min: number, max: number }
    expect(summary.rows).toBe(7)
    expect(summary.total).toBe(660)
    expect(summary.min).toBe(10)
    expect(summary.max).toBe(500)
    expect(summary.median).toBe(30)

    const contributors = result.topContributors as { dimension: JsonValue, value: number, share: number }[]
    expect(contributors).toHaveLength(3)
    expect(contributors[0].dimension).toBe('C')
    expect(contributors[0].value).toBe(540)
    expect(contributors[0].share).toBeCloseTo(540 / 660, 3)

    const concentration = result.concentration as { groups: number, top1Share: number, topNGroups: number, topNShare: number, pareto80Groups: number }
    expect(concentration.groups).toBe(3)
    expect(concentration.top1Share).toBeCloseTo(540 / 660, 3)
    expect(concentration.topNGroups).toBe(3)
    expect(concentration.topNShare).toBe(1)
    // 540/660 already clears 80%, so a single group covers the bulk.
    expect(concentration.pareto80Groups).toBe(1)

    const trend = result.trend as { direction: string, firstHalfAvg: number, secondHalfAvg: number }
    expect(trend.direction).toBe('up')
    expect(trend.firstHalfAvg).toBe(20)
    expect(trend.secondHalfAvg).toBeCloseTo(560 / 3, 2)
  })

  it('flags the extreme value as a z-score outlier', async () => {
    const result = await insight(ctx, 'SELECT day, region, amount FROM sales ORDER BY day', { measure: 'amount' })
    const anomalies = result.anomalies as { value: number, zScore: number }[]
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies[0].value).toBe(500)
    expect(Math.abs(anomalies[0].zScore)).toBeGreaterThanOrEqual(2)
  })

  it('auto-detects the measure column when none is given', async () => {
    const result = await insight(ctx, 'SELECT day, region, amount FROM sales', {})
    expect(result.measure).toBe('amount')
    expect((result.summary as { rows: number }).rows).toBe(7)
  })

  it('refuses a result with no usable numeric column', async () => {
    await expect(insight(ctx, 'SELECT day, region FROM sales', {})).rejects.toThrow(/numeric column/)
  })
})
