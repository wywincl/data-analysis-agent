import { describe, expect, it } from 'vitest'
import { createDuckdbProvider } from '../src/datasources/duckdb.ts'

/**
 * The duckdb-async native driver is intentionally NOT a dependency of this
 * repo — the provider must degrade gracefully: it constructs fine (wiring is
 * lazy) and only the first query fails, with an actionable install hint.
 */
describe('createDuckdbProvider (graceful degradation)', () => {
  it('constructs without the native driver installed', () => {
    const provider = createDuckdbProvider('duck', undefined)
    expect(provider.name).toBe('duck')
    expect(provider.type).toBe('duckdb')
    expect(provider.dialect).toBe('sqlite')
  })

  it('fails the first query with a clear install hint', async () => {
    const provider = createDuckdbProvider('duck', undefined)
    await expect(provider.query('SELECT 1', { timeoutMs: 2_000, maxRows: 10 }))
      .rejects.toThrow(/DuckDB driver not installed/)
  })

  it('close() is a no-op before any query', async () => {
    const provider = createDuckdbProvider('duck', ':memory:')
    await expect(provider.close()).resolves.toBeUndefined()
  })
})
