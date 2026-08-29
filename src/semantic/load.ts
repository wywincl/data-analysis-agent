/**
 * Semantic layer YAML loading and validation. Validation is hand-rolled
 * (fail with the file path + line-adjacent context) rather than schema-lib
 * based: the config is operator-authored, so errors must be actionable.
 *
 * @module dsh-rd-data-analysis/semantic/load
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { METRIC_AGGS, type SemanticConfig, type SemanticEntity, type SemanticMetric } from './types.ts'
import { isSafeIdentifier } from '../sql/guard.ts'

export class SemanticConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticConfigError'
  }
}

function assertIdent(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isSafeIdentifier(value)) {
    throw new SemanticConfigError(`${what} must be a plain identifier, got: ${JSON.stringify(value)}`)
  }
  return value
}

function assertOptionalIdent(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return assertIdent(value, what)
}

function assertStringArray(value: unknown, what: string, allowPredicates: boolean): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new SemanticConfigError(`${what} must be an array`)
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new SemanticConfigError(`${what}[${index}] must be a non-empty string`)
    }
    if (!allowPredicates && !isSafeIdentifier(entry)) {
      throw new SemanticConfigError(`${what}[${index}] must be a plain identifier, got: ${JSON.stringify(entry)}`)
    }
    return entry
  })
}

function parseEntity(raw: unknown, index: number): SemanticEntity {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`entities[${index}] must be a mapping`)
  const entity = raw as Record<string, unknown>
  const table = assertIdent(entity.table, `entities[${index}].table`)
  const columns = entity.columns === undefined || entity.columns === null
    ? undefined
    : (Array.isArray(entity.columns) ? entity.columns : (() => {
      throw new SemanticConfigError(`entities[${index}].columns must be an array`)
    })()).map((column: unknown, columnIndex: number) => {
      if (column === null || typeof column !== 'object') throw new SemanticConfigError(`entities[${index}].columns[${columnIndex}] must be a mapping`)
      const entry = column as Record<string, unknown>
      return {
        name: assertIdent(entry.name, `entities[${index}].columns[${columnIndex}].name`),
        ...(entry.label !== undefined ? { label: String(entry.label) } : {}),
        ...(entry.description !== undefined ? { description: String(entry.description) } : {}),
        ...(entry.unit !== undefined ? { unit: String(entry.unit) } : {}),
      }
    })
  return {
    ...(assertOptionalIdent(entity.datasource, `entities[${index}].datasource`) !== undefined
      ? { datasource: entity.datasource as string }
      : {}),
    table,
    ...(entity.label !== undefined ? { label: String(entity.label) } : {}),
    ...(entity.description !== undefined ? { description: String(entity.description) } : {}),
    ...(columns !== undefined ? { columns } : {}),
  }
}

function parseMetric(raw: unknown, index: number, entityNames: ReadonlySet<string>): SemanticMetric {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`metrics[${index}] must be a mapping`)
  const metric = raw as Record<string, unknown>
  const name = assertIdent(metric.name, `metrics[${index}].name`)
  const agg = metric.agg
  if (typeof agg !== 'string' || !(METRIC_AGGS as readonly string[]).includes(agg)) {
    throw new SemanticConfigError(`metrics[${index}].agg must be one of ${METRIC_AGGS.join('/')}`)
  }
  const entity = assertIdent(metric.entity, `metrics[${index}].entity`)
  if (!entityNames.has(entity)) {
    throw new SemanticConfigError(`metrics[${index}].entity "${entity}" is not defined in entities`)
  }
  const measure = assertOptionalIdent(metric.measure, `metrics[${index}].measure`)
  if (measure === undefined && agg !== 'count') {
    throw new SemanticConfigError(`metrics[${index}]: agg "${agg}" requires "measure"`)
  }
  return {
    name,
    ...(metric.label !== undefined ? { label: String(metric.label) } : {}),
    ...(metric.description !== undefined ? { description: String(metric.description) } : {}),
    ...(assertOptionalIdent(metric.datasource, `metrics[${index}].datasource`) !== undefined
      ? { datasource: metric.datasource as string }
      : {}),
    entity,
    ...(measure !== undefined ? { measure } : {}),
    agg: agg as SemanticMetric['agg'],
    ...(metric.formula !== undefined ? { formula: String(metric.formula) } : {}),
    ...(metric.grain !== undefined ? { grain: String(metric.grain) } : {}),
    ...(assertOptionalIdent(metric.timeField, `metrics[${index}].timeField`) !== undefined
      ? { timeField: metric.timeField as string }
      : {}),
    dimensions: assertStringArray(metric.dimensions, `metrics[${index}].dimensions`, false),
    filters: assertStringArray(metric.filters, `metrics[${index}].filters`, true),
    ...(metric.unit !== undefined ? { unit: String(metric.unit) } : {}),
  }
}

/** Parse and validate one semantic config document (throws SemanticConfigError). */
export function parseSemanticConfig(source: string): SemanticConfig {
  let raw: unknown
  try {
    raw = parseYaml(source)
  } catch (error) {
    throw new SemanticConfigError(`semantic YAML parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object') throw new SemanticConfigError('semantic config root must be a mapping')
  const root = raw as Record<string, unknown>

  const defaults = root.defaults !== undefined && root.defaults !== null
    ? root.defaults as Record<string, unknown>
    : {}
  if (typeof defaults !== 'object') throw new SemanticConfigError('defaults must be a mapping')

  const entities = root.entities === undefined || root.entities === null
    ? []
    : (Array.isArray(root.entities) ? root.entities : (() => {
      throw new SemanticConfigError('entities must be an array')
    })()).map(parseEntity)
  const entityNames = new Set(entities.map((entity) => entity.table))

  const terms = root.terms === undefined || root.terms === null
    ? []
    : (Array.isArray(root.terms) ? root.terms : (() => {
      throw new SemanticConfigError('terms must be an array')
    })()).map((term: unknown, index: number) => {
      if (term === null || typeof term !== 'object') throw new SemanticConfigError(`terms[${index}] must be a mapping`)
      const entry = term as Record<string, unknown>
      if (typeof entry.name !== 'string' || entry.name.trim() === '') throw new SemanticConfigError(`terms[${index}].name is required`)
      if (typeof entry.description !== 'string' || entry.description.trim() === '') throw new SemanticConfigError(`terms[${index}].description is required`)
      return {
        name: entry.name,
        description: entry.description,
        ...(entry.aliases !== undefined ? { aliases: assertStringArray(entry.aliases, `terms[${index}].aliases`, true) } : {}),
      }
    })

  const metrics = root.metrics === undefined || root.metrics === null
    ? []
    : (Array.isArray(root.metrics) ? root.metrics : (() => {
      throw new SemanticConfigError('metrics must be an array')
    })()).map((metric: unknown, index: number) => parseMetric(metric, index, entityNames))

  const names = new Set<string>()
  for (const metric of metrics) {
    if (names.has(metric.name)) throw new SemanticConfigError(`duplicate metric name "${metric.name}"`)
    names.add(metric.name)
  }

  return {
    ...(defaults.datasource !== undefined ? { defaults: { datasource: String(defaults.datasource) } } : {}),
    entities,
    terms,
    metrics,
  }
}

/** Load and parse a semantic config file from disk. */
export function loadSemanticFile(file: string): SemanticConfig {
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    throw new SemanticConfigError(`cannot read semantic file ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseSemanticConfig(source)
}
