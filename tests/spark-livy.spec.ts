import { describe, expect, it } from 'vitest'
import { createSparkLivyProvider, parseLivyTextTable, type LivyHttpClient } from '../src/datasources/spark-livy.ts'

describe('parseLivyTextTable', () => {
  it('parses a pipe-delimited Livy text table', () => {
    const text = [
      'city\tamount',
      '杭州\t100',
      '上海\t200',
    ].join('\n')
    const parsed = parseLivyTextTable(text)
    expect(parsed.columns).toEqual(['city', 'amount'])
    expect(parsed.rows).toEqual([{ city: '杭州', amount: '100' }, { city: '上海', amount: '200' }])
  })

  it('parses pipe tables and drops separator lines', () => {
    const parsed = parseLivyTextTable('| city | amount |\n| Hangzhou | 10 |')
    expect(parsed.columns).toEqual(['city', 'amount'])
    expect(parsed.rows).toEqual([{ city: 'Hangzhou', amount: '10' }])
  })

  it('returns empty on empty input', () => {
    expect(parseLivyTextTable('')).toEqual({ columns: [], rows: [] })
  })
})

/**
 * Fake Livy REST server: one idle session, one statement that immediately
 * becomes available with a text/plain table payload.
 */
function fakeLivy(table: string, opts: { statementError?: boolean } = {}): LivyHttpClient {
  return async (method, url) => {
    if (method === 'POST' && url.endsWith('/sessions')) {
      return { status: 201, json: { id: 7, state: 'starting' }, text: '{}' }
    }
    if (method === 'GET' && /\/sessions\/\d+$/.test(url)) {
      return { status: 200, json: { id: 7, state: 'idle' }, text: '{}' }
    }
    if (method === 'POST' && /\/sessions\/\d+\/statements$/.test(url)) {
      return { status: 201, json: { id: 0, state: 'running' }, text: '{}' }
    }
    if (method === 'GET' && /\/statements\/\d+$/.test(url)) {
      if (opts.statementError === true) {
        return { status: 200, json: { id: 0, state: 'available', output: { status: 'error', ename: 'AnalysisException', evalue: 'table not found' } }, text: '{}' }
      }
      return { status: 200, json: { id: 0, state: 'available', output: { status: 'ok', data: { 'text/plain': table } } }, text: '{}' }
    }
    if (method === 'POST' && url.endsWith('/kill')) {
      return { status: 200, json: {}, text: '' }
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
}

describe('createSparkLivyProvider (fake HTTP)', () => {
  const opts = { timeoutMs: 5_000, maxRows: 10 }

  it('runs a query through session → statement → parsed rows', async () => {
    const provider = createSparkLivyProvider('spark', {
      livyUrl: 'http://livy:8998',
      pollIntervalMs: 1,
    }, fakeLivy('city\tamount\n杭州\t100\n上海\t200'))
    expect(provider.dialect).toBe('hive')
    expect(provider.type).toBe('spark')
    expect(provider.mock).toBeUndefined()
    const result = await provider.query('SELECT city, amount FROM sales', opts)
    expect(result.rowCount).toBe(2)
    expect(result.rows).toEqual([{ city: '杭州', amount: '100' }, { city: '上海', amount: '200' }])
    expect(result.columns.map((col) => col.name)).toEqual(['city', 'amount'])
  })

  it('surfaces statement errors from Livy output', async () => {
    const provider = createSparkLivyProvider('spark', {
      livyUrl: 'http://livy:8998',
      pollIntervalMs: 1,
    }, fakeLivy('', { statementError: true }))
    await expect(provider.query('SELECT nope', opts)).rejects.toThrow(/AnalysisException|table not found/)
  })

  it('rejects when the session never becomes idle (timeout)', async () => {
    const slow: LivyHttpClient = async () => ({ status: 201, json: { id: 1 }, text: '{}' })
    const provider = createSparkLivyProvider('spark', {
      livyUrl: 'http://livy:8998',
      heartbeatTimeoutMs: 5,
      pollIntervalMs: 1,
    }, slow)
    // Session POST succeeds but polls never return idle → createSession times out.
    // (POST /sessions returns id:1, then GET /sessions/1 also returns id:1 with no state.)
    await expect(provider.query('SELECT 1', opts)).rejects.toThrow(/did not become ready|no id/i)
  })
})
