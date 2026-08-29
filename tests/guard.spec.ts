/**
 * SQL guardrail test matrix: read-only enforcement, LIMIT injection, and
 * fail-closed parse behavior across dialects.
 */
import { describe, expect, it } from 'vitest'
import { guardSelectOnly, GuardError, isSafeIdentifier, quoteIdentifier } from '../src/sql/guard.ts'

const ok = (sql: string, dialect: Parameters<typeof guardSelectOnly>[1] = 'sqlite') => guardSelectOnly(sql, dialect, 100)

describe('guardSelectOnly — accepts', () => {
  it('plain SELECT', () => {
    const result = ok('SELECT id, amount FROM orders WHERE amount > 100')
    expect(result.sql.startsWith('SELECT')).toBe(true)
  })

  it('SELECT with existing LIMIT (kept, not doubled)', () => {
    const result = ok('SELECT * FROM orders LIMIT 5')
    expect(result.sql).toBe('SELECT * FROM orders LIMIT 5')
  })

  it('WITH … SELECT (CTE)', () => {
    const result = ok('WITH t AS (SELECT * FROM orders) SELECT * FROM t')
    expect(result.sql.startsWith('WITH')).toBe(true)
  })

  it('injects LIMIT when missing and trims trailing semicolon', () => {
    const result = ok('SELECT * FROM orders;')
    expect(result.sql).toBe('SELECT * FROM orders LIMIT 100')
  })

  it('aggregations, joins, and dialect-specific syntax', () => {
    expect(() => ok('SELECT city, COUNT(*) AS c FROM users GROUP BY city ORDER BY c DESC')).not.toThrow()
    expect(() => ok('SELECT u.city, SUM(o.amount) FROM orders o JOIN users u ON u.id = o.user_id GROUP BY u.city', 'mysql')).not.toThrow()
    expect(() => ok('SELECT id FROM orders LIMIT 5 OFFSET 10', 'postgresql')).not.toThrow()
  })
})

describe('guardSelectOnly — rejects', () => {
  const reject = (sql: string, dialect: Parameters<typeof guardSelectOnly>[1] = 'sqlite') =>
    expect(() => ok(sql, dialect)).toThrow(GuardError)

  it('DELETE / UPDATE / INSERT / DROP', () => {
    reject('DELETE FROM orders')
    reject('UPDATE orders SET amount = 0')
    reject('INSERT INTO orders VALUES (1)')
    reject('DROP TABLE orders')
    reject('CREATE TABLE t (id int)', 'postgresql')
  })

  it('multiple statements', () => {
    reject('SELECT 1; SELECT 2')
    reject('SELECT 1; DROP TABLE orders')
  })

  it('locking / INTO / OUTFILE constructs even when parseable', () => {
    reject('SELECT * FROM orders FOR UPDATE', 'postgresql')
    reject("SELECT * FROM orders INTO OUTFILE '/tmp/x'", 'mysql')
  })

  it('unparseable SQL (fail closed)', () => {
    reject('SELEC * FORM orders')
    reject('`') // garbage
  })

  it('pragmas / commands that are not SELECT', () => {
    reject('PRAGMA table_info(orders)')
  })
})

describe('identifier helpers', () => {
  it('accepts plain and qualified names', () => {
    expect(isSafeIdentifier('amount')).toBe(true)
    expect(isSafeIdentifier('u.city')).toBe(true)
    expect(isSafeIdentifier('user_id')).toBe(true)
  })

  it('rejects injection attempts', () => {
    expect(isSafeIdentifier('amount; DROP TABLE orders')).toBe(false)
    expect(isSafeIdentifier('(SELECT 1)')).toBe(false)
    expect(isSafeIdentifier('a--b')).toBe(false)
  })

  it('quotes per dialect', () => {
    expect(quoteIdentifier('orders', 'mysql')).toBe('`orders`')
    expect(quoteIdentifier('public.orders'.split('.')[1], 'postgresql')).toBe('"orders"')
  })
})
