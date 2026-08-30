/**
 * Schema-drift lint: compare the semantic layer against the *live* database
 * schema (via introspection) rather than only checking internal self-consistency
 * like {@link lint.ts}. Catches the rot that internal lint cannot: a column the
 * layer references that was renamed/dropped in the warehouse, an entity whose
 * table no longer exists, a metric measure that drifted out of sync.
 *
 * This runs on demand (the `data-semantic-validate` command) because it needs a
 * live connection, not at compose time.
 *
 * @module dsh-data-analysis/semantic/drift
 */

import type { SchemaInfo } from '../types.ts'
import type { LintIssue, SemanticConfig, SemanticEntity } from './types.ts'

/** Column names present on a table in the live schema, or null if table missing. */
function columnsOf(schema: SchemaInfo, table: string): Set<string> | null {
  const found = schema.tables.find((entry) => entry.name === table)
  if (found === undefined) return null
  return new Set(found.columns.map((column) => column.name))
}

/** Lint one entity + its metrics against a live schema for the same datasource. */
export function lintAgainstSchema(config: SemanticConfig, schema: SchemaInfo): LintIssue[] {
  const issues: LintIssue[] = []
  const entities = config.entities ?? []
  const byTable = new Map<string, SemanticEntity>()
  for (const entity of entities) byTable.set(entity.table, entity)

  for (const entity of entities) {
    const cols = columnsOf(schema, entity.table)
    if (cols === null) {
      issues.push({
        severity: 'warning',
        code: 'drift-table-missing',
        path: `entities[] ${entity.table}`,
        params: { table: entity.table, datasource: schema.datasource },
      })
      continue
    }
    for (const column of entity.columns ?? []) {
      if (!cols.has(column.name)) {
        issues.push({
          severity: 'warning',
          code: 'drift-column-missing',
          path: `entities[] ${entity.table}.columns[] ${column.name}`,
          params: { table: entity.table, column: column.name },
        })
      }
    }
  }

  for (const metric of config.metrics ?? []) {
    const entity = byTable.get(metric.entity)
    if (entity === undefined) continue
    const cols = columnsOf(schema, entity.table)
    if (cols === null) continue
    const checkColumn = (column: string | undefined, where: string): void => {
      if (column !== undefined && !cols.has(column)) {
        issues.push({
          severity: 'warning',
          code: 'drift-column-missing',
          path: `metrics[] ${metric.name} ${where}`,
          params: { table: entity.table, column },
        })
      }
    }
    if (metric.agg === 'ratio') {
      for (const side of [metric.numerator, metric.denominator]) {
        if (side?.measure !== undefined) checkColumn(side.measure, `ratio ${side.metric ?? side.entity ?? ''}`)
      }
    } else if (metric.agg !== 'count' && metric.agg !== 'expression') {
      checkColumn(metric.measure, 'measure')
    }
    for (const dimension of metric.dimensions ?? []) {
      if (!cols.has(dimension)) {
        issues.push({
          severity: 'warning',
          code: 'drift-column-missing',
          path: `metrics[] ${metric.name} dimensions[] ${dimension}`,
          params: { table: entity.table, column: dimension },
        })
      }
    }
  }

  return issues
}
