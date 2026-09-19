/**
 * Semantic layer scaffolding.
 *
 * Turns a datasource's introspected schema into a starter semantic config
 * (entities with columns + a few sensible default metrics). The workbench UI
 * uses this for its "generate from datasource" action so operators skip the
 * boilerplate of hand-writing every entity/metric.
 *
 * Two things are inferred by naming convention, because they carry the
 * ontology's structure and the lint engine validates them afterwards:
 *  - `key` — a column literally named `id` becomes the entity's primary key;
 *  - `relationships` — an `X_id` (or `XId`) column pointing at a resolvable
 *    entity X with a primary key becomes a `many-to-one` FK, so cross-entity
 *    metrics can `joins: [X]` right away.
 *
 * The output is otherwise intentionally conservative: it only encodes what
 * introspection can prove (table + column names, numeric columns). Business
 * labels, 口径 filters and dimensions are left for the operator to refine.
 *
 * @module dsh-data-analysis/semantic/scaffold
 */

import type { SchemaInfo, TableInfo } from '../types.ts'
import type { SemanticConfig, SemanticEntity, SemanticMetric, SemanticTerm } from './types.ts'

/** Numeric-ish SQL types that make sensible `sum` / `avg` measure candidates. */
const NUMERIC_TYPES = /^(int|integer|bigint|smallint|tinyint|decimal|numeric|float|double|real|number|money|numeric|bigserial|serial)/i
/** Temporal types that make a sensible `timeField`. */
const TEMPORAL_TYPES = /^(date|datetime|timestamp|time)/i

/** A generated, editable semantic config. */
export interface ScaffoldResult {
  entities: SemanticEntity[]
  metrics: SemanticMetric[]
  terms: SemanticTerm[]
}

/** Does a reported column type look numeric? */
function isNumeric(dataType: string): boolean {
  return NUMERIC_TYPES.test(dataType.trim())
}

/**
 * Does a reported column look temporal? Type-based for first-class temporal
 * types; name-based for loose stores (SQLite TEXT dates, VARCHAR id columns)
 * where the schema driver cannot distinguish a date from a note — a column
 * that stays temporal through the previous rule contributes nothing to the
 * entity's timeField choice.
 */
function isTemporal(dataType: string, name: string): boolean {
  if (TEMPORAL_TYPES.test(dataType.trim())) return true
  // Exact temporal-style names (dt, ts, date, time, …).
  if (/^(dt|ts|date|time|datetime|timestamp)$/i.test(name)) return true
  // Temporal-name suffixes: created_at, signup_date, order_time, …
  return /(_at|_date|_time|_ts|_dt|_day|_month|_year)$/i.test(name)
}

/**
 * Build a starter semantic config from introspected schema.
 *
 * @param schema introspected {@link SchemaInfo} for one datasource.
 * @param datasource the datasource name the generated config should default to.
 */
export function scaffoldFromIntrospection(schema: SchemaInfo, datasource: string): ScaffoldResult {
  const entities: SemanticEntity[] = []
  const metrics: SemanticMetric[] = []
  const terms: SemanticTerm[] = []

  for (const table of schema.tables) {
    if (table.type === 'view') continue
    const entity = entityFromTable(table)
    entities.push(entity)
    // A temporal column becoming the entity's timeField satisfies the
    // `unbounded-metric` lint for its metrics — carry it onto each metric so
    // the generated layer starts warning-free when a time column exists.
    const timeField = entity.timeField

    // One total-row count metric per table — the universal, always-valid KPI.
    metrics.push({
      name: `${table.name}_count`,
      label: `${table.name} 记录数`,
      entity: table.name,
      agg: 'count',
      datasource,
      grain: '按表',
      ...(timeField !== undefined ? { timeField } : {}),
    })

    // sum/avg for each numeric column (skip obvious surrogate keys by name).
    for (const column of table.columns) {
      if (!isNumeric(column.dataType)) continue
      if (/(_id|id)$/i.test(column.name) && !/(amount|price|qty|quantity|count|num|total|sum|fee|cost|balance)/i.test(column.name)) continue
      const measure = column.name
      metrics.push({
        name: `${table.name}_${measure}_sum`,
        label: `${table.name}.${measure} 合计`,
        entity: table.name,
        measure,
        agg: 'sum',
        datasource,
        grain: '按表',
        ...(timeField !== undefined ? { timeField } : {}),
      })
      metrics.push({
        name: `${table.name}_${measure}_avg`,
        label: `${table.name}.${measure} 均值`,
        entity: table.name,
        measure,
        agg: 'avg',
        datasource,
        grain: '按表',
        ...(timeField !== undefined ? { timeField } : {}),
      })
    }
  }

  attachIdentityAndRelations(entities, schema.tables)

  return { entities, metrics, terms }
}

/**
 * Infer `key` + `many-to-one` relationships from naming conventions.
 * An `X_id` (or `XId`) column resolves to entity X — matching the exact,
 * singular, and plural spellings of X against the introspected tables — and
 * needs a primary key column on the target (`id`, or `<target>_id`) to join
 * on. Self-references (`parent_id`) resolve the same way.
 */
function attachIdentityAndRelations(entities: SemanticEntity[], tables: readonly TableInfo[]): void {
  const entityByTable = new Map(entities.map((entity) => [entity.table, entity]))
  const singularOf = (name: string): string => name.replace(/ies$/i, 'y').replace(/s$/i, '')
  for (const table of tables) {
    const entity = entityByTable.get(table.name)
    if (entity === undefined) continue

    const pk = table.columns.find((column) => /^id$/i.test(column.name))
    if (pk !== undefined) entity.key = pk.name

    const relationships: NonNullable<SemanticEntity['relationships']> = []
    for (const column of table.columns) {
      const snake = /^(.+?)_id$/i.exec(column.name)
      const camel = /^([a-z0-9]+)Id$/.exec(column.name)
      const base = (snake ?? camel)?.[1]
      if (base === undefined) continue
      const candidates = new Set([base.toLowerCase(), singularOf(base).toLowerCase()])
      candidates.add(`${base.toLowerCase()}s`)
      candidates.add(singularOf(base).toLowerCase() + 's')
      const target = tables.find((entry) => entry.type !== 'view' && candidates.has(entry.name.toLowerCase()))
      if (target === undefined) continue
      const targetPk = target.columns.find((entry) => /^id$/i.test(entry.name))
        ?? target.columns.find((entry) => entry.name.toLowerCase() === `${target.name}_id`.toLowerCase())
      if (targetPk === undefined) continue
      relationships.push({ entity: target.name, on: [column.name, targetPk.name], cardinality: 'many-to-one' })
    }
    if (relationships.length > 0) entity.relationships = relationships
  }
}

/** Build one entity (table + column business labels) from introspection. */
function entityFromTable(table: TableInfo): SemanticEntity {
  const columns = table.columns.map((column) => {
    const columnMeta: { name: string, label?: string, unit?: string } = { name: column.name }
    if (isTemporal(column.dataType, column.name)) columnMeta.label = `${column.name} (时间)`
    else if (isNumeric(column.dataType)) columnMeta.label = `${column.name} (数值)`
    return columnMeta
  })
  const entity: SemanticEntity = { table: table.name, columns }
  // A temporal column becomes the default time field when present.
  const timeColumn = table.columns.find((column) => isTemporal(column.dataType, column.name))
  if (timeColumn !== undefined) entity.timeField = timeColumn.name
  return entity
}
