import { describe, expect, it, vi } from 'vitest'
import { JobStore, type QueryJob } from '../src/jobs.ts'
import type { DataSourceProvider, QueryOptions, QueryResult } from '../src/types.ts'

/** Deterministic fake provider: resolves after `delayMs`, or rejects when told to. */
function fakeProvider(name = 'demo', behavior: { delayMs?: number, rows?: number, fail?: boolean, onSignal?: boolean } = {}): DataSourceProvider {
  const rows = Array.from({ length: behavior.rows ?? 3 }, (_, i) => ({ id: i, label: `row-${i}` }))
  return {
    name,
    type: 'sqlite',
    dialect: 'sqlite',
    async query(sql: string, options: QueryOptions): Promise<QueryResult> {
      if (behavior.onSignal && options.signal !== undefined) {
        await new Promise<void>((resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(new Error('Query aborted before execution.')), { once: true })
        })
      }
      if (behavior.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, behavior.delayMs))
      if (behavior.fail === true) throw new Error('boom')
      return {
        columns: [{ name: 'id', type: 'integer' }, { name: 'label', type: 'text' }],
        rows: rows as unknown as QueryResult['rows'],
        rowCount: rows.length,
        truncated: false,
        ...(sql.includes('marker') ? {} : {}),
      }
    },
    async introspect() { throw new Error('not needed') },
    async close() {},
  }
}

describe('JobStore', () => {
  it('runs a submitted job to succeeded and pages its rows', async () => {
    const store = new JobStore(60_000, 20)
    const job = store.start('job-1', fakeProvider(), 'SELECT 1', { timeoutMs: 5_000, maxRows: 100 })
    expect(job.status).toMatch(/pending|running/)
    // Wait for the background run to settle.
    await vi.waitFor(() => {
      expect(store.get('job-1')?.status).toBe('succeeded')
    })
    const done = store.get('job-1') as QueryJob
    expect(done.rowCount).toBe(3)
    const page = store.rows('job-1', 1, 2)
    expect(page?.total).toBe(3)
    expect(page?.rows).toHaveLength(2)
    expect(page?.rows[0]?.id).toBe(1)
    expect(page?.columns.map((col) => col.name)).toEqual(['id', 'label'])
  })

  it('records failures with the error message', async () => {
    const store = new JobStore(60_000, 20)
    store.start('job-2', fakeProvider('demo', { fail: true }), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    await vi.waitFor(() => {
      expect(store.get('job-2')?.status).toBe('failed')
    })
    const failed = store.get('job-2') as QueryJob
    expect(failed.error).toBe('boom')
    expect(store.rows('job-2', 0, 10)).toBeUndefined()
  })

  it('cancels a running job and aborts its provider signal', async () => {
    const store = new JobStore(60_000, 20)
    store.start('job-3', fakeProvider('demo', { onSignal: true }), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    expect(store.cancel('job-3')).toBe(true)
    await vi.waitFor(() => {
      const job = store.get('job-3')
      // The run promise rejects (aborted) but the cancelled status survives.
      expect(job?.status).toBe('cancelled')
    })
    // Cancelling a finished/cancelled job is refused.
    expect(store.cancel('job-3')).toBe(false)
  })

  it('expires jobs past the TTL', async () => {
    const store = new JobStore(150, 20)
    store.start('job-4', fakeProvider(), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    await vi.waitFor(() => {
      expect(store.get('job-4')?.status).toBe('succeeded')
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(store.get('job-4')).toBeUndefined()
    expect(store.rows('job-4', 0, 10)).toBeUndefined()
  })

  it('evicts the oldest job beyond the size bound', () => {
    const store = new JobStore(60_000, 2)
    store.start('a', fakeProvider(), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    store.start('b', fakeProvider(), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    store.start('c', fakeProvider(), 'SELECT 1', { timeoutMs: 5_000, maxRows: 10 })
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')?.jobId).toBe('b')
    expect(store.get('c')?.jobId).toBe('c')
  })
})
