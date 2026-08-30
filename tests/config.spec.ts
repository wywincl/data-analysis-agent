/**
 * Plugin config tests: flat-schema validation (numeric ranges, per-source
 * required fields, duplicate names) and the per-source limits resolution.
 */
import { describe, expect, it } from 'vitest'
import { validateConfig, limitsFor, type Config } from '../src/config.ts'

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    dataSources: [],
    defaultDatasource: '',
    semanticFile: '',
    defaultMaxRows: 500,
    defaultTimeoutMs: 20_000,
    modelRowCap: 50,
    chartDataCap: 500,
    schemaCacheTtlMs: 300_000,
    exportDir: '',
    resultCacheSize: 50,
    resultCacheTtlMs: 30 * 60_000,
    asyncJobTtlMs: 10 * 60_000,
    asyncJobCacheSize: 20,
    locale: 'zh',
    currentRole: '',
    ...overrides,
  }
}

function sqlite(name = 'demo'): Config['dataSources'][number] {
  return { name, type: 'sqlite', file: '/tmp/demo.db', approvalMode: 'auto' }
}

describe('validateConfig', () => {
  it('accepts a valid default config', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [sqlite()] }))).not.toThrow()
  })

  it('rejects duplicate datasource names', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [sqlite('dup'), sqlite('dup')] })))
      .toThrow(/duplicate datasource name/)
  })

  it('rejects sqlite without file', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [{ name: 'demo', type: 'sqlite' }] })))
      .toThrow(/requires "file"/)
  })

  it('rejects mysql/postgres/clickhouse without host or database', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [{ name: 'm', type: 'mysql', host: 'h' }] })))
      .toThrow(/requires "host" and "database"/)
  })

  it('rejects a negative defaultMaxRows', () => {
    expect(() => validateConfig(baseConfig({ defaultMaxRows: 0 }))).toThrow(/defaultMaxRows/)
  })

  it('rejects a too-small defaultTimeoutMs', () => {
    expect(() => validateConfig(baseConfig({ defaultTimeoutMs: 50 }))).toThrow(/defaultTimeoutMs/)
  })

  it('rejects non-positive modelRowCap and chartDataCap', () => {
    expect(() => validateConfig(baseConfig({ modelRowCap: 0 }))).toThrow(/modelRowCap/)
    expect(() => validateConfig(baseConfig({ chartDataCap: -1 }))).toThrow(/chartDataCap/)
  })

  it('rejects per-source maxRows < 1', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [{ ...sqlite(), maxRows: 0 }] })))
      .toThrow(/maxRows/)
  })

  it('rejects per-source timeoutMs < 100', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [{ ...sqlite(), timeoutMs: 10 }] })))
      .toThrow(/timeoutMs/)
  })

  it('rejects defaultDatasource that does not match any configured source', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [sqlite('a')], defaultDatasource: 'missing' })))
      .toThrow(/defaultDatasource/)
  })

  it('accepts defaultDatasource matching a configured source', () => {
    expect(() => validateConfig(baseConfig({ dataSources: [sqlite('a')], defaultDatasource: 'a' })))
      .not.toThrow()
  })
})

describe('limitsFor', () => {
  it('falls back to global defaults when the source does not override', () => {
    const cfg = baseConfig({ defaultMaxRows: 123, defaultTimeoutMs: 4567 })
    const limits = limitsFor(cfg, undefined)
    expect(limits.maxRows).toBe(123)
    expect(limits.timeoutMs).toBe(4567)
  })

  it('prefers per-source limits', () => {
    const cfg = baseConfig({ defaultMaxRows: 123, defaultTimeoutMs: 4567 })
    const ds = { ...sqlite(), maxRows: 99, timeoutMs: 1000 }
    const limits = limitsFor(cfg, ds)
    expect(limits.maxRows).toBe(99)
    expect(limits.timeoutMs).toBe(1000)
  })
})
