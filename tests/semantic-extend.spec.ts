/**
 * Tests for the extended semantic layer: ratio metrics, expression metrics,
 * cross-table joins (relationships), and row-level security (rowFilter +
 * sensitive masking).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SemanticLayer } from '../src/semantic/layer.ts'

const YAML = `
defaults:
  datasource: demo
entities:
  - table: orders
    label: 订单
    dimensions: [status, user_id, tenant_id]
    columns:
      - { name: user_id, label: 用户 }
      - { name: amount, label: 金额 }
      - { name: status, label: 状态 }
      - { name: tenant_id, label: 租户 }
      - { name: created_at, label: 时间 }
    relationships:
      - entity: users
        on: [user_id, user_id]
    rowFilter: "tenant_id = '{role}'"
  - table: users
    label: 用户
    dimensions: [city, country]
    columns:
      - { name: city, label: 城市, sensitive: true }
      - { name: country, label: 国家 }
    readRoles: [admin]
metrics:
  - name: paid_amount
    entity: orders
    measure: amount
    agg: sum
    filters: ["status = 'paid'"]
  - name: paid_orders
    entity: orders
    agg: count
    filters: ["status = 'paid'"]
  - name: all_orders
    entity: orders
    agg: count
  - name: paid_rate
    entity: orders
    agg: ratio
    dimensions: []
    numerator: { metric: paid_orders }
    denominator: { metric: all_orders }
  - name: paid_rate_by_user
    entity: orders
    agg: ratio
    numerator: { metric: paid_orders }
    denominator: { metric: all_orders }
    dimensions: [user_id]
  - name: revenue_per_head
    entity: orders
    agg: expression
    expression: "SUM(amount) / NULLIF(COUNT(*), 0)"
  - name: city_revenue
    entity: orders
    measure: amount
    agg: sum
    joins: [users]
    dimensions: [city]
`

let dir: string
let layer: SemanticLayer

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rd-sem-ext-'))
  const file = join(dir, 'semantic.yaml')
  writeFileSync(file, YAML, 'utf8')
  layer = new SemanticLayer(file)
})

afterEach(() => {
  layer.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('ratio metrics', () => {
  it('builds a scalar ratio via two metric subqueries', () => {
    const built = layer.buildMetricSql('paid_rate', {}, 'sqlite', {})
    expect(built.sql).toContain('NULLIF')
    expect(built.sql).toContain('COUNT(*)')
    expect(built.columns.map((c) => c.name)).toEqual(['value'])
  })

  it('builds a grouped ratio joined on the dimension', () => {
    const built = layer.buildMetricSql('paid_rate_by_user', { dimensions: ['user_id'] }, 'sqlite', {})
    expect(built.sql).toContain('LEFT JOIN')
    expect(built.sql).toContain('ON num.')
    expect(built.columns.map((c) => c.name)).toEqual(['user_id', 'value'])
  })
})

describe('expression metrics', () => {
  it('uses the trusted expression verbatim as the aggregate', () => {
    const built = layer.buildMetricSql('revenue_per_head', {}, 'sqlite', {})
    expect(built.sql).toContain('SUM(amount) / NULLIF(COUNT(*), 0)')
  })
})

describe('cross-table joins', () => {
  it('emits a JOIN through the entity relationship and qualifies the dimension', () => {
    const built = layer.buildMetricSql('city_revenue', { dimensions: ['city'] }, 'sqlite', {})
    expect(built.sql).toContain('JOIN "users" AS users ON orders."user_id" = users."user_id"')
    expect(built.sql).toContain('users."city"')
    expect(built.sql).toContain('SUM(orders."amount")')
  })

  it('supports dotted column references into the joined table', () => {
    const built = layer.buildMetricSql('city_revenue', { dimensions: ['users.city'] }, 'sqlite', {})
    expect(built.sql).toContain('users."city"')
  })
})

describe('row-level security', () => {
  it('applies the base entity rowFilter with {role} substituted when a role is active', () => {
    const built = layer.buildMetricSql('paid_amount', {}, 'sqlite', { currentRole: 'acme' })
    expect(built.sql).toContain("tenant_id = 'acme'")
  })

  it('skips the rowFilter when no role is active', () => {
    const built = layer.buildMetricSql('paid_amount', {}, 'sqlite', {})
    expect(built.sql).not.toContain('tenant_id =')
  })

  it('masks a sensitive column to NULL when the role lacks read access', () => {
    const built = layer.buildMetricSql('city_revenue', { dimensions: ['city'] }, 'sqlite', { currentRole: 'acme' })
    expect(built.sql).toContain('NULL AS "city"')
  })

  it('does not mask when the role is in readRoles', () => {
    const built = layer.buildMetricSql('city_revenue', { dimensions: ['city'] }, 'sqlite', { currentRole: 'admin' })
    expect(built.sql).not.toContain('NULL AS "city"')
    expect(built.sql).toContain('users."city"')
  })
})
