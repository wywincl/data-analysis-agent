import { describe, expect, it } from 'vitest'
import { costUnits, QueryAuditStore } from '../src/audit.ts'

describe('costUnits', () => {
  it('meters 1 per row and 10 per second', () => {
    expect(costUnits(100, 0)).toBe(100)
    expect(costUnits(0, 1000)).toBe(10)
    expect(costUnits(50, 2500)).toBe(75)
  })
})

describe('QueryAuditStore', () => {
  it('records entries with incrementing ids and ISO timestamps', () => {
    const audit = new QueryAuditStore(100)
    const first = audit.record({ kind: 'run_sql', datasource: 'demo', sql: 'SELECT 1', durationMs: 5, role: '' })
    const second = audit.record({ kind: 'query_metric', datasource: 'demo', sql: 'SELECT 2', durationMs: 6, role: 'analyst', meta: { metric: 'paid_amount' } })
    expect(first?.id).toBe(1)
    expect(second?.id).toBe(2)
    expect(first?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(second?.role).toBe('analyst')
    expect(second?.meta).toEqual({ metric: 'paid_amount' })
  })

  it('caps the ring buffer at max entries (oldest evicted)', () => {
    const audit = new QueryAuditStore(3)
    for (let i = 0; i < 5; i++) audit.record({ kind: 'run_sql', datasource: 'demo', sql: `SELECT ${i}`, durationMs: 1, role: '' })
    const all = audit.all()
    expect(all).toHaveLength(3)
    expect(all[0].sql).toBe('SELECT 2')
    expect(all[2].sql).toBe('SELECT 4')
  })

  it('is a no-op when auditing is disabled (max = 0)', () => {
    const audit = new QueryAuditStore(0)
    expect(audit.record({ kind: 'run_sql', datasource: 'demo', sql: 'SELECT 1', durationMs: 1, role: '' })).toBeUndefined()
    expect(audit.all()).toHaveLength(0)
  })

  it('recent(n) returns the newest n entries, newest first', () => {
    const audit = new QueryAuditStore(100)
    for (let i = 0; i < 10; i++) audit.record({ kind: 'run_sql', datasource: 'demo', sql: `SELECT ${i}`, durationMs: 1, role: '' })
    const recent = audit.recent(3)
    expect(recent.map((entry) => entry.sql)).toEqual(['SELECT 9', 'SELECT 8', 'SELECT 7'])
  })

  it('aggregates per-datasource usage, errors, and cost (sorted by cost desc)', () => {
    const audit = new QueryAuditStore(100)
    audit.record({ kind: 'run_sql', datasource: 'spark', sql: 'SELECT 1', rowCount: 1000, durationMs: 10_000, role: '' })
    audit.record({ kind: 'run_sql', datasource: 'spark', sql: 'SELECT 2', rowCount: 500, durationMs: 2_000, role: '' })
    audit.record({ kind: 'run_sql', datasource: 'demo', sql: 'SELECT 3', rowCount: 10, durationMs: 5, role: '' })
    audit.record({ kind: 'query_metric', datasource: 'demo', sql: 'SELECT 4', durationMs: 5, role: '', error: 'boom' })
    const summary = audit.summary()
    expect(summary[0].datasource).toBe('spark')
    expect(summary[0].queries).toBe(2)
    expect(summary[0].rows).toBe(1500)
    expect(summary[0].cost).toBe(1000 + 100 + 500 + 20)
    expect(summary[0].errors).toBe(0)
    expect(summary[1].datasource).toBe('demo')
    expect(summary[1].queries).toBe(2)
    expect(summary[1].errors).toBe(1)
    expect(summary[1].avgMs).toBe(5)
  })
})
