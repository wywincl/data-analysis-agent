/**
 * Connectivity probe tests: the probe must report online for a reachable
 * engine and offline (with a message) for a failing one, never throwing.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteProvider } from '../src/datasources/sqlite.ts'
import { probeProvider } from '../src/datasources/probe.ts'
import type { DataSourceProvider } from '../src/types.ts'

describe('probeProvider', () => {
  it('reports online for a reachable SQLite database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-probe-'))
    const file = join(dir, 'demo.db')
    const provider = createSqliteProvider('demo', file)
    const status = await probeProvider(provider, 20_000)
    expect(status.online).toBe(true)
    expect(status.message).toBe('')
    expect(typeof status.at).toBe('number')
    await provider.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports offline with a message when the query fails', async () => {
    const failing: DataSourceProvider = {
      name: 'broken', type: 'sqlite', dialect: 'sqlite',
      query: async () => { throw new Error('connection refused') },
      introspect: async () => ({ datasource: 'broken', dialect: 'sqlite', tables: [], truncated: false }),
      close: async () => {},
    }
    const status = await probeProvider(failing, 20_000)
    expect(status.online).toBe(false)
    expect(status.message).toContain('connection refused')
  })
})
