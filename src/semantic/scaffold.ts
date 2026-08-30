/**
 * Semantic layer scaffolding.
 *
 * Turns a datasource's introspected schema into a starter semantic config
 * (entities with columns + a few sensible default metrics). The workbench UI
 * uses this for its "generate from datasource" action so operators skip the
 * boilerplate of hand-writing every entity/metric.
 *
 * The output is intentionally conservative: it only encodes what introspection
 * can prove (table + column names, numeric columns). Business labels,口径
 * filters, dimensions and relationships are left for the operator to refine —
 * the lint engine will surface anything undefined.
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

/** Does a reported column type look temporal? */
function isTemporal(dataType: string): boolean {
  return TEMPORAL_TYPES.test(dataType.trim())
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
    entities.push(entityFromTable(table))

    // One total-row count metric per table — the universal, always-valid KPI.
    metrics.push({
      name: `${table.name}_count`,
      label: `${table.name} 记录数`,
      entity: table.name,
      agg: 'count',
      datasource,
      grain: '按表',
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
      })
      metrics.push({
        name: `${table.name}_${measure}_avg`,
        label: `${table.name}.${measure} 均值`,
        entity: table.name,
        measure,
        agg: 'avg',
        datasource,
        grain: '按表',
      })
    }
  }

  return { entities, metrics, terms }
}

/** Build one entity (table + column business labels) from introspection. */
function entityFromTable(table: TableInfo): SemanticEntity {
  const columns = table.columns.map((column) => {
    const columnMeta: { name: string, label?: string, unit?: string } = { name: column.name }
    if (isTemporal(column.dataType)) columnMeta.label = `${column.name} (时间)`
    else if (isNumeric(column.dataType)) columnMeta.label = `${column.name} (数值)`
    return columnMeta
  })
  const entity: SemanticEntity = { table: table.name, columns }
  // A temporal column becomes the default time field when present.
  const timeColumn = table.columns.find((column) => isTemporal(column.dataType))
  if (timeColumn !== undefined) entity.timeField = timeColumn.name
  return entity
}
