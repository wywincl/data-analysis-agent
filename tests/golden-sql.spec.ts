/**
 * Golden-SQL regression for the semantic layer SQL builder.
 *
 * The fixture is tests/fixtures/golden-semantic.yaml. Every case below pins
 * the EXACT SQL emitted by buildMetricSql for one feature of the builder:
 *   - plain aggregate + default time dimension
 *   - multi-dimension breakdown + time-range WHERE
 *   - metric-level predicate filters
 *   - JOIN via entity relationships
 *   - ratio metrics (scalar + grouped)
 *   - expression measures with filter pushdown
 *   - rowFilter substitution ({role} placeholder)
 *   - sensitive column masking vs readRoles bypass
 *
 * If you intentionally change the SQL shape (dialect quoting, clause order,
 * aliasing rules, ...), update the golden strings here and review the diff
 * like a snapshot test. Accidental drift should fail this suite.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SemanticLayer } from '../src/semantic/layer.ts'

const layer = new SemanticLayer('tests/fixtures/golden-semantic.yaml')

function build(metric: string, query: Record<string, unknown> = {}, options?: Record<string, unknown>): string {
  return layer.buildMetricSql(metric, query as never, 'sqlite', options).sql
}

describe('golden SQL: semantic layer builder', () => {
  it('fixture loads with the expected metrics and entities (no lint issues)', () => {
    const catalog = layer.catalog()
    expect(catalog.metrics.map((m) => m.name).sort()).toEqual([
      'avg_amount_expr',
      'daily_revenue',
      'order_rate',
      'order_rate_by_city',
      'paying_orders',
      'revenue_by_city',
    ])
    expect(catalog.entities.map((e) => e.table).sort()).toEqual(['orders', 'users'])
    expect(catalog.error).toBeUndefined()
  })

  it('daily_revenue — plain aggregate over default time dimension', () => {
    expect(build('daily_revenue')).toBe([
      'SELECT orders."created_at" AS "created_at", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      'GROUP BY orders."created_at"',
      'ORDER BY orders."created_at" ASC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('daily_revenue — multi-dimension breakdown with time range', () => {
    expect(build('daily_revenue', {
      dimensions: ['status', 'city'],
      from: '2026-03-01',
      to: '2026-03-31',
    })).toBe([
      'SELECT orders."status" AS "status", orders."city" AS "city", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      "WHERE orders.\"created_at\" >= '2026-03-01'",
      // A date-only `to` covers the WHOLE end day on datetime columns:
      // `<= '2026-03-31'` would exclude everything after midnight.
      "  AND orders.\"created_at\" < '2026-04-01'",
      'GROUP BY orders."status", orders."city"',
      'ORDER BY value DESC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('paying_orders — metric-level predicate filter is inlined as raw SQL', () => {
    expect(build('paying_orders', { dimensions: ['city'] })).toBe([
      'SELECT orders."city" AS "city", COUNT(*) AS "value"',
      'FROM "orders" AS orders',
      "WHERE status = 'paid'",
      'GROUP BY orders."city"',
      'ORDER BY value DESC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('revenue_by_city — JOIN emitted from entity relationship', () => {
    expect(build('revenue_by_city', { dimensions: ['city'] })).toBe([
      'SELECT orders."city" AS "city", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      'JOIN "users" AS users ON orders."user_id" = users."user_id"',
      'GROUP BY orders."city"',
      'ORDER BY value DESC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('order_rate — scalar ratio (numerator over denominator subqueries)', () => {
    expect(build('order_rate')).toBe([
      'SELECT (SELECT COUNT(*) AS v',
      'FROM "orders"',
      "WHERE status = 'paid') / NULLIF((SELECT COUNT(*) AS v",
      'FROM "orders"), 0) AS value',
      'FROM (SELECT COUNT(*) AS v',
      'FROM "orders"',
      "WHERE status = 'paid') AS num, (SELECT COUNT(*) AS v",
      'FROM "orders") AS den',
      'LIMIT 500',
    ].join('\n'))
  })

  it('order_rate_by_city — grouped ratio via COALESCE + LEFT JOIN on dimension', () => {
    expect(build('order_rate_by_city', { dimensions: ['city'] })).toBe([
      'SELECT COALESCE(num."city", den."city") AS "city", num.v / NULLIF(den.v, 0) AS value',
      'FROM (SELECT "city" AS "city", COUNT(*) AS v',
      'FROM "orders"',
      "WHERE status = 'paid'",
      'GROUP BY "city") AS num',
      'LEFT JOIN (SELECT "city" AS "city", COUNT(*) AS v',
      'FROM "orders"',
      'GROUP BY "city") AS den ON num."city" = den."city"',
      'LIMIT 500',
    ].join('\n'))
  })

  it('avg_amount_expr — expression measure with FILTER pushdown', () => {
    expect(build('avg_amount_expr')).toBe([
      'SELECT orders."created_at" AS "created_at", AVG(orders."amount") FILTER (WHERE orders."status" = \'paid\') AS "value"',
      'FROM "orders" AS orders',
      'GROUP BY orders."created_at"',
      'ORDER BY orders."created_at" ASC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('daily_revenue — rowFilter {role} placeholder substituted with current role', () => {
    expect(build('daily_revenue', {}, { currentRole: 'acme' })).toBe([
      'SELECT orders."created_at" AS "created_at", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      "WHERE tenant_id = 'acme'",
      'GROUP BY orders."created_at"',
      'ORDER BY orders."created_at" ASC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('revenue_by_city — sensitive join column masked to NULL for unauthorized role', () => {
    expect(build('revenue_by_city', { dimensions: ['users.city'] }, { currentRole: 'viewer' })).toBe([
      'SELECT NULL AS "users.city", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      'JOIN "users" AS users ON orders."user_id" = users."user_id"',
      "WHERE tenant_id = 'viewer'",
      'GROUP BY users."city"',
      'ORDER BY value DESC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('revenue_by_city — readRoles bypass exposes the sensitive column', () => {
    expect(build('revenue_by_city', { dimensions: ['users.city'] }, { currentRole: 'admin' })).toBe([
      'SELECT users."city" AS "users.city", SUM(orders."amount") AS "value"',
      'FROM "orders" AS orders',
      'JOIN "users" AS users ON orders."user_id" = users."user_id"',
      "WHERE tenant_id = 'admin'",
      'GROUP BY users."city"',
      'ORDER BY value DESC',
      'LIMIT 500',
    ].join('\n'))
  })

  it('fixture is hand-authored YAML — guard against accidental rewrites', () => {
    const text = readFileSync('tests/fixtures/golden-semantic.yaml', 'utf8')
    expect(text).toContain('rowFilter: "tenant_id = \'{role}\'"')
    expect(text).toContain('filters: ["status = \'paid\'"]')
    expect(text).toContain('agg: ratio')
    expect(text).toContain('sensitive: true')
  })
})
