/**
 * Analysis computations: NULL/empty handling (a NULL coerced to 0 through
 * Number() silently poisons every statistic), the topn aggregate whitelist,
 * and the numeric-as-string profile path (mysql decimalNumbers:false).
 */
import { describe, expect, it } from 'vitest'
import { correlation, distribution, insight, profile, topn, type AnalysisContext } from '../src/analysis/analyze.ts'
import { GuardError } from '../src/sql/guard.ts'

function fakeCtx(rows: Record<string, unknown>[]): AnalysisContext {
  return {
    dialect: 'sqlite',
    run: async () => ({ columns: [], rows: rows as never, rowCount: rows.length, truncated: false }),
  }
}

describe('NULL handling (Number(null) === 0 regression)', () => {
  it('correlation drops NULL/empty pairs instead of counting them as 0', async () => {
    const ctx = fakeCtx([
      { a: 1, b: 2 },
      { a: 2, b: 4 },
      { a: 3, b: 6 },
      { a: null, b: 10 }, // Number(null) === 0 — old code polluted the mean
      { a: '', b: 20 }, // Number('') === 0
      { a: undefined, b: 30 },
    ])
    const result = await correlation(ctx, 'SELECT a, b FROM t', { column: 'a', column2: 'b' })
    expect(result.pairs).toBe(3)
    expect(result.pearsonR).toBe(1)
  })

  it('distribution excludes NULL/empty from the histogram', async () => {
    // The real provider aliases the selected column to `value` (`AS value`) —
    // the fake returns pre-aliased rows.
    const ctx = fakeCtx([
      { value: 1 }, { value: 2 }, { value: 3 }, { value: null }, { value: '' }, { value: 4 },
    ])
    const result = await distribution(ctx, 'SELECT v FROM t', { column: 'v' })
    expect(result.samples).toBe(4)
    expect(result.min).toBe(1)
    expect(result.max).toBe(4)
  })

  it('insight row-grain stats ignore NULL/empty measure values', async () => {
    const ctx = fakeCtx([
      { value: 10 }, { value: 20 }, { value: null }, { value: '' }, { value: 30 },
    ])
    const result = await insight(ctx, 'SELECT m FROM t', { measure: 'm' })
    const summary = result.summary as { rows: number, mean: number }
    expect(summary.rows).toBe(3)
    expect(summary.mean).toBe(20)
  })
})

describe('topn aggregate whitelist (runtime defense for the tool enum)', () => {
  it('rejects a non-whitelisted aggregate before it reaches SQL', async () => {
    const ctx = fakeCtx([])
    await expect(topn(ctx, 'SELECT * FROM t', { dimension: 'city', aggregate: 'SUM(amount); DROP TABLE x' as never }))
      .rejects.toThrow(GuardError)
  })

  it('accepts the whitelisted aggregates', async () => {
    const ctx = fakeCtx([{ dimension: '杭州', value: 5 }])
    const result = await topn(ctx, 'SELECT * FROM t', { dimension: 'city', aggregate: 'sum', metric: 'amount' })
    expect(result.aggregate).toBe('sum')
  })
})

describe('profile numeric detection', () => {
  it('treats all-numeric-string columns (mysql DECIMAL as text) as numeric', async () => {
    const ctx = fakeCtx([
      { amount: '100.5', status: 'paid' },
      { amount: '200.5', status: 'refunded' },
      { amount: '300.5', status: 'paid' },
    ])
    const result = await profile(ctx, 'SELECT * FROM t')
    const columns = result.columns as { column: string, numeric?: unknown, topValues?: unknown }[]
    const amount = columns.find((c) => c.column === 'amount')
    expect(amount?.numeric).toBeDefined()
    const status = columns.find((c) => c.column === 'status')
    expect(status?.topValues).toBeDefined()
  })
})
