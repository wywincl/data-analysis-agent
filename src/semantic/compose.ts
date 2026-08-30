/**
 * Semantic layer composition: merge fragments, then resolve inheritance.
 *
 * Two passes over the fragments produced by {@link include.ts}:
 *
 * **1. Merge.** Fragments are ordered dependency-first (included files before
 * their includer), so the includer wins every conflict. Entities key on
 * `table`, terms and metrics on `name`. A clash is reported as a
 * `duplicate-definition` lint warning rather than a hard error: overriding a
 * shared base file is a legitimate use, but silently losing a definition is
 * not, so the loser's origin file is named in the message.
 *
 * **2. Inherit.** Each metric is resolved against three axes, lowest
 * precedence first:
 *
 * ```
 * defaults.datasource / timeField / filters / dimensions
 *   └─ entity.datasource / timeField / filters / dimensions
 *        └─ extends chain (root base → direct base)
 *             └─ the metric itself
 * ```
 *
 * Most fields override (nearest declaration wins). `filters` is the one
 * exception: **every level is AND-ed together**, because a fixed口径 predicate
 * is a constraint, and a child narrowing a base must never be able to drop the
 * base's constraint by declaring its own. Everything is resolved away — a
 * composed config contains no `extends`, no implicit defaults — so downstream
 * code (SQL builder, catalog, prompt digest) stays dumb and total.
 *
 * @module dsh-data-analysis/semantic/compose
 */

import type { LoadedFragment } from './include.ts'
import { SemanticConfigError } from './errors.ts'
import { lintSemanticConfig } from './lint.ts'
import {
  METRIC_AGGS,
  type LintIssue,
  type MetricAgg,
  type SemanticConfig,
  type SemanticDefaults,
  type SemanticEntity,
  type SemanticMetric,
  type SemanticTerm,
} from './types.ts'
import { isSafeIdentifier } from '../sql/guard.ts'

/** A metric as authored: `extends` present, `entity`/`agg` possibly inherited. */
type RawMetric = { name: string } & Partial<SemanticMetric>

/** One fragment after per-fragment validation, before any cross-file merge. */
interface RawLayer {
  defaults: SemanticDefaults
  entities: SemanticEntity[]
  terms: SemanticTerm[]
  metrics: RawMetric[]
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

/** `undefined` in, `undefined` out — absence must stay distinguishable from `[]`. */
function assertOptionalStringArray(value: unknown, what: string, allowPredicates: boolean): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return assertStringArray(value, what, allowPredicates)
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value)
}

function parseDefaults(raw: unknown, file: string): SemanticDefaults {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`${file}: defaults must be a mapping`)
  const entry = raw as Record<string, unknown>
  return {
    ...(entry.datasource !== undefined ? { datasource: String(entry.datasource) } : {}),
    ...(assertOptionalIdent(entry.timeField, `${file}: defaults.timeField`) !== undefined
      ? { timeField: entry.timeField as string }
      : {}),
    ...(assertOptionalStringArray(entry.filters, `${file}: defaults.filters`, true) !== undefined
      ? { filters: entry.filters as string[] }
      : {}),
    ...(assertOptionalStringArray(entry.dimensions, `${file}: defaults.dimensions`, false) !== undefined
      ? { dimensions: entry.dimensions as string[] }
      : {}),
  }
}

function parseEntity(raw: unknown, index: number, file: string): SemanticEntity {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`${file}: entities[${index}] must be a mapping`)
  const entry = raw as Record<string, unknown>
  const columns = entry.columns === undefined || entry.columns === null
    ? undefined
    : (Array.isArray(entry.columns) ? entry.columns : (() => {
      throw new SemanticConfigError(`${file}: entities[${index}].columns must be an array`)
    })()).map((column: unknown, columnIndex: number) => {
      if (column === null || typeof column !== 'object') {
        throw new SemanticConfigError(`${file}: entities[${index}].columns[${columnIndex}] must be a mapping`)
      }
      const col = column as Record<string, unknown>
      return {
        name: assertIdent(col.name, `${file}: entities[${index}].columns[${columnIndex}].name`),
        ...(optionalString(col.label) !== undefined ? { label: String(col.label) } : {}),
        ...(optionalString(col.description) !== undefined ? { description: String(col.description) } : {}),
        ...(optionalString(col.unit) !== undefined ? { unit: String(col.unit) } : {}),
        ...(entry.columns !== null && typeof col.sensitive === 'boolean' ? { sensitive: col.sensitive } : {}),
      }
    })
  const relationships = entry.relationships === undefined || entry.relationships === null
    ? undefined
    : (Array.isArray(entry.relationships) ? entry.relationships : (() => {
      throw new SemanticConfigError(`${file}: entities[${index}].relationships must be an array`)
    })()).map((relationship: unknown, relationshipIndex: number) => {
      if (relationship === null || typeof relationship !== 'object') {
        throw new SemanticConfigError(`${file}: entities[${index}].relationships[${relationshipIndex}] must be a mapping`)
      }
      const rel = relationship as Record<string, unknown>
      const on = rel.on
      if (!Array.isArray(on) || on.length !== 2 || typeof on[0] !== 'string' || typeof on[1] !== 'string') {
        throw new SemanticConfigError(`${file}: entities[${index}].relationships[${relationshipIndex}].on must be [thisColumn, relatedColumn]`)
      }
      return {
        entity: assertIdent(rel.entity, `${file}: entities[${index}].relationships[${relationshipIndex}].entity`),
        on: [assertIdent(on[0], 'relationship from-column'), assertIdent(on[1], 'relationship to-column')] as [string, string],
      }
    })
  return {
    ...(assertOptionalIdent(entry.datasource, `${file}: entities[${index}].datasource`) !== undefined
      ? { datasource: entry.datasource as string }
      : {}),
    table: assertIdent(entry.table, `${file}: entities[${index}].table`),
    ...(optionalString(entry.label) !== undefined ? { label: String(entry.label) } : {}),
    ...(optionalString(entry.description) !== undefined ? { description: String(entry.description) } : {}),
    ...(assertOptionalIdent(entry.timeField, `${file}: entities[${index}].timeField`) !== undefined
      ? { timeField: entry.timeField as string }
      : {}),
    ...(assertOptionalStringArray(entry.filters, `${file}: entities[${index}].filters`, true) !== undefined
      ? { filters: entry.filters as string[] }
      : {}),
    ...(assertOptionalStringArray(entry.dimensions, `${file}: entities[${index}].dimensions`, false) !== undefined
      ? { dimensions: entry.dimensions as string[] }
      : {}),
    ...(columns !== undefined ? { columns } : {}),
    ...(relationships !== undefined && relationships.length > 0 ? { relationships } : {}),
    ...(optionalString(entry.rowFilter) !== undefined ? { rowFilter: String(entry.rowFilter) } : {}),
    ...(assertOptionalStringArray(entry.readRoles, `${file}: entities[${index}].readRoles`, false) !== undefined
      ? { readRoles: entry.readRoles as string[] }
      : {}),
  }
}

function parseTerm(raw: unknown, index: number, file: string): SemanticTerm {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`${file}: terms[${index}] must be a mapping`)
  const entry = raw as Record<string, unknown>
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw new SemanticConfigError(`${file}: terms[${index}].name is required`)
  }
  if (typeof entry.description !== 'string' || entry.description.trim() === '') {
    throw new SemanticConfigError(`${file}: terms[${index}].description is required`)
  }
  return {
    name: entry.name,
    description: entry.description,
    ...(assertOptionalStringArray(entry.aliases, `${file}: terms[${index}].aliases`, true) !== undefined
      ? { aliases: entry.aliases as string[] }
      : {}),
  }
}

/** Parse one side of a ratio metric (inline aggregate or a metric reference). */
function parseMetricRef(raw: unknown, file: string, metricIndex: number, side: string): { metric?: string, entity?: string, measure?: string, agg?: MetricAgg, filters?: string[] } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new SemanticConfigError(`${file}: metrics[${metricIndex}].${side} must be a mapping`)
  const entry = raw as Record<string, unknown>
  return {
    ...(assertOptionalIdent(entry.metric, `${file}: metrics[${metricIndex}].${side}.metric`) !== undefined ? { metric: entry.metric as string } : {}),
    ...(assertOptionalIdent(entry.entity, `${file}: metrics[${metricIndex}].${side}.entity`) !== undefined ? { entity: entry.entity as string } : {}),
    ...(assertOptionalIdent(entry.measure, `${file}: metrics[${metricIndex}].${side}.measure`) !== undefined ? { measure: entry.measure as string } : {}),
    ...(entry.agg !== undefined && (typeof entry.agg === 'string' && (METRIC_AGGS as readonly string[]).includes(entry.agg))
      ? { agg: entry.agg as MetricAgg }
      : {}),
    ...(assertOptionalStringArray(entry.filters, `${file}: metrics[${metricIndex}].${side}.filters`, true) !== undefined ? { filters: entry.filters as string[] } : {}),
  }
}

function parseMetric(raw: unknown, index: number, file: string): RawMetric {
  if (raw === null || typeof raw !== 'object') throw new SemanticConfigError(`${file}: metrics[${index}] must be a mapping`)
  const entry = raw as Record<string, unknown>
  const name = assertIdent(entry.name, `${file}: metrics[${index}].name`)
  const extendsName = assertOptionalIdent(entry.extends, `${file}: metrics[${index}].extends`)
  const inheriting = extendsName !== undefined
  // With `extends`, entity/agg/measure may all come from the base — that is the
  // whole point of the base. Without it they are mandatory and checked here.
  const entity = inheriting
    ? assertOptionalIdent(entry.entity, `${file}: metrics[${index}].entity`)
    : assertIdent(entry.entity, `${file}: metrics[${index}].entity`)
  const agg = entry.agg
  if (agg !== undefined && (typeof agg !== 'string' || !(METRIC_AGGS as readonly string[]).includes(agg))) {
    throw new SemanticConfigError(`${file}: metrics[${index}].agg must be one of ${METRIC_AGGS.join('/')}`)
  }
  if (agg === undefined && !inheriting) {
    throw new SemanticConfigError(`${file}: metrics[${index}].agg is required (or use extends to inherit one)`)
  }
  const numerator = parseMetricRef(entry.numerator, file, index, 'numerator')
  const denominator = parseMetricRef(entry.denominator, file, index, 'denominator')
  const joins = assertOptionalStringArray(entry.joins, `${file}: metrics[${index}].joins`, false)
  return {
    name,
    ...(extendsName !== undefined ? { extends: extendsName } : {}),
    ...(entity !== undefined ? { entity } : {}),
    ...(agg !== undefined ? { agg: agg as MetricAgg } : {}),
    ...(assertOptionalIdent(entry.measure, `${file}: metrics[${index}].measure`) !== undefined
      ? { measure: entry.measure as string }
      : {}),
    ...(optionalString(entry.label) !== undefined ? { label: String(entry.label) } : {}),
    ...(optionalString(entry.description) !== undefined ? { description: String(entry.description) } : {}),
    ...(assertOptionalIdent(entry.datasource, `${file}: metrics[${index}].datasource`) !== undefined
      ? { datasource: entry.datasource as string }
      : {}),
    ...(optionalString(entry.formula) !== undefined ? { formula: String(entry.formula) } : {}),
    ...(optionalString(entry.grain) !== undefined ? { grain: String(entry.grain) } : {}),
    ...(assertOptionalIdent(entry.timeField, `${file}: metrics[${index}].timeField`) !== undefined
      ? { timeField: entry.timeField as string }
      : {}),
    ...(optionalString(entry.expression) !== undefined ? { expression: String(entry.expression) } : {}),
    ...(numerator !== undefined ? { numerator } : {}),
    ...(denominator !== undefined ? { denominator } : {}),
    ...(joins !== undefined && joins.length > 0 ? { joins } : {}),
    dimensions: assertOptionalStringArray(entry.dimensions, `${file}: metrics[${index}].dimensions`, false),
    filters: assertOptionalStringArray(entry.filters, `${file}: metrics[${index}].filters`, true),
    ...(optionalString(entry.unit) !== undefined ? { unit: String(entry.unit) } : {}),
  }
}

function parseLayer(doc: unknown, file: string): RawLayer {
  if (doc === null || doc === undefined) return { defaults: {}, entities: [], terms: [], metrics: [] }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SemanticConfigError(`${file}: 语义层配置根节点必须是 mapping`)
  }
  const root = doc as Record<string, unknown>
  const list = (value: unknown, what: string): unknown[] => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new SemanticConfigError(`${file}: ${what} must be an array`)
    return value
  }
  return {
    defaults: root.defaults === undefined || root.defaults === null ? {} : parseDefaults(root.defaults, file),
    entities: list(root.entities, 'entities').map((raw, index) => parseEntity(raw, index, file)),
    terms: list(root.terms, 'terms').map((raw, index) => parseTerm(raw, index, file)),
    metrics: list(root.metrics, 'metrics').map((raw, index) => parseMetric(raw, index, file)),
  }
}

/** Nearest declaration wins: walk the chain from the metric itself up to the root base. */
function pick<K extends keyof SemanticMetric>(chain: readonly RawMetric[], key: K): SemanticMetric[K] | undefined {
  for (let index = chain.length - 1; index >= 0; index--) {
    const value = chain[index][key]
    if (value !== undefined) return value as SemanticMetric[K]
  }
  return undefined
}

/** Set of entity tables reachable from `start` via `relationships` (BFS, ≤3 hops). */
function reachableEntities(start: string, entities: Map<string, { entity: SemanticEntity, file: string }>): Set<string> {
  const seen = new Set<string>([start])
  let frontier = [start]
  for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const current of frontier) {
      const node = entities.get(current)
      for (const rel of node?.entity.relationships ?? []) {
        if (!seen.has(rel.entity)) {
          seen.add(rel.entity)
          next.push(rel.entity)
        }
      }
    }
    frontier = next
  }
  return seen
}

const COLLECTIONS = { entity: 'entities', term: 'terms', metric: 'metrics' } as const

function duplicateIssue(kind: keyof typeof COLLECTIONS, key: string, loserFile: string, winnerFile: string): LintIssue {
  return {
    severity: 'warning',
    code: 'duplicate-definition',
    path: `${winnerFile}: ${COLLECTIONS[kind]}["${key}"]`,
    // Wording lives in the i18n dictionary so the operator reads it in their
    // own language; the path already says which kind of entry it is.
    params: { winner: winnerFile, loser: loserFile },
  }
}

export interface ComposeResult {
  config: SemanticConfig
  /** Non-fatal problems found in the composed config (never blocks the load). */
  issues: readonly LintIssue[]
  /** Provenance for error paths: `entity:<table>` / `term:<name>` / `metric:<name>` → file path. */
  origins: Readonly<Record<string, string>>
}

/** Merge fragments and resolve every inheritance axis. Throws SemanticConfigError on structural faults. */
export function composeSemantic(fragments: readonly LoadedFragment[]): ComposeResult {
  const layers = fragments.map((fragment) => ({ file: fragment.file, layer: parseLayer(fragment.doc, fragment.file) }))
  const issues: LintIssue[] = []
  const origins: Record<string, string> = {}

  let defaults: SemanticDefaults = {}
  const entities = new Map<string, { entity: SemanticEntity, file: string }>()
  const terms = new Map<string, { term: SemanticTerm, file: string }>()
  const metrics = new Map<string, { metric: RawMetric, file: string }>()

  for (const { file, layer } of layers) {
    defaults = { ...defaults, ...layer.defaults }
    for (const entity of layer.entities) {
      const previous = entities.get(entity.table)
      if (previous !== undefined) issues.push(duplicateIssue('entity', entity.table, previous.file, file))
      entities.set(entity.table, { entity, file })
    }
    for (const term of layer.terms) {
      const previous = terms.get(term.name)
      if (previous !== undefined) issues.push(duplicateIssue('term', term.name, previous.file, file))
      terms.set(term.name, { term, file })
    }
    for (const metric of layer.metrics) {
      const previous = metrics.get(metric.name)
      if (previous !== undefined) issues.push(duplicateIssue('metric', metric.name, previous.file, file))
      metrics.set(metric.name, { metric, file })
    }
  }

  // --- extends resolution -------------------------------------------------
  const chainOf = (name: string): RawMetric[] => {
    const chain: RawMetric[] = []
    const seen = new Set<string>()
    let current = metrics.get(name)
    while (current !== undefined) {
      const { metric } = current
      if (seen.has(metric.name)) {
        throw new SemanticConfigError(`指标继承链成环: ${[...seen, metric.name].join(' → ')}`)
      }
      seen.add(metric.name)
      chain.unshift(metric)
      const base = metric.extends
      if (base === undefined) break
      const next = metrics.get(base)
      if (next === undefined) {
        throw new SemanticConfigError(
          `metrics["${name}"] (${current.file}): extends "${base}" 未定义。已定义指标: ${[...metrics.keys()].join(', ') || '(无)'}`,
        )
      }
      current = next
    }
    return chain
  }

  const resolvedMetrics: SemanticMetric[] = []
  for (const [name, entry] of metrics) {
    origins[`metric:${name}`] = entry.file
    const chain = chainOf(name)

    const entityName = pick(chain, 'entity')
    if (entityName === undefined) {
      throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): 缺少 entity,且继承链上没有定义 entity 的基础指标`)
    }
    const entity = entities.get(entityName)
    if (entity === undefined) {
      throw new SemanticConfigError(
        `metrics["${name}"] (${entry.file}): entity "${entityName}" 未在 entities 中定义。已定义: ${[...entities.keys()].join(', ') || '(无)'}`,
      )
    }

    const agg = pick(chain, 'agg')
    if (agg === undefined) {
      throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): 缺少 agg,且继承链上没有定义 agg 的基础指标`)
    }
    const measure = pick(chain, 'measure')
    if (agg !== 'count' && agg !== 'ratio' && agg !== 'expression' && measure === undefined) {
      throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): agg "${agg}" 需要 measure(继承链上也没有)`)
    }
    if (agg === 'ratio') {
      const num = pick(chain, 'numerator')
      const den = pick(chain, 'denominator')
      if (num === undefined || den === undefined) {
        throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): agg "ratio" 需要 numerator 与 denominator`)
      }
    }
    if (agg === 'expression') {
      const expression = pick(chain, 'expression')
      if (expression === undefined) {
        throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): agg "expression" 需要 expression 字段`)
      }
    }
    // joins must be reachable from this entity via relationships (BFS, depth ≤ 3).
    const joins = pick(chain, 'joins')
    if (joins !== undefined && joins.length > 0) {
      const reachable = reachableEntities(entityName, entities)
      for (const join of joins) {
        if (!reachable.has(join)) {
          throw new SemanticConfigError(`metrics["${name}"] (${entry.file}): joins 包含不可达实体 "${join}"（需通过 entities 的 relationships 串联,当前实体 "${entityName}" 仅能到达: ${[...reachable].join('/') || '(无)'})`)
        }
      }
    }

    const timeField = pick(chain, 'timeField') ?? entity.entity.timeField ?? defaults.timeField
    const datasource = pick(chain, 'datasource') ?? entity.entity.datasource ?? defaults.datasource
    const dimensions = pick(chain, 'dimensions') ?? entity.entity.dimensions ?? defaults.dimensions
    // filters ACCUMULATE across every level; identical predicates collapse so a
    // child restating its base's口径 does not emit it twice into the SQL.
    const filters = [...new Set([
      ...(defaults.filters ?? []),
      ...(entity.entity.filters ?? []),
      ...chain.flatMap((metric) => metric.filters ?? []),
    ])]

    resolvedMetrics.push({
      name,
      ...(pick(chain, 'label') !== undefined ? { label: pick(chain, 'label') as string } : {}),
      ...(pick(chain, 'description') !== undefined ? { description: pick(chain, 'description') as string } : {}),
      ...(datasource !== undefined ? { datasource } : {}),
      entity: entityName,
      ...(measure !== undefined ? { measure } : {}),
      agg,
      ...(pick(chain, 'formula') !== undefined ? { formula: pick(chain, 'formula') as string } : {}),
      ...(pick(chain, 'grain') !== undefined ? { grain: pick(chain, 'grain') as string } : {}),
      ...(timeField !== undefined ? { timeField } : {}),
      ...(dimensions !== undefined && dimensions.length > 0 ? { dimensions } : {}),
      ...(filters.length > 0 ? { filters } : {}),
      ...(pick(chain, 'unit') !== undefined ? { unit: pick(chain, 'unit') as string } : {}),
      ...(joins !== undefined && joins.length > 0 ? { joins } : {}),
      ...(agg === 'ratio' ? {
        numerator: pick(chain, 'numerator') as NonNullable<SemanticMetric['numerator']>,
        denominator: pick(chain, 'denominator') as NonNullable<SemanticMetric['denominator']>,
      } : {}),
      ...(agg === 'expression' ? { expression: pick(chain, 'expression') as string } : {}),
    })
  }

  for (const [table, entry] of entities) origins[`entity:${table}`] = entry.file
  for (const [termName, entry] of terms) origins[`term:${termName}`] = entry.file

  // --- relationship / RLS structural validation (one pass over entities) ---
  for (const [table, entry] of entities) {
    for (const rel of entry.entity.relationships ?? []) {
      if (!entities.has(rel.entity)) {
        throw new SemanticConfigError(`entities["${table}"] (${entry.file}): relationship 指向未定义实体 "${rel.entity}"`)
      }
    }
  }

  const config: SemanticConfig = {
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    entities: [...entities.values()].map((entry) => entry.entity),
    terms: [...terms.values()].map((entry) => entry.term),
    metrics: resolvedMetrics,
  }
  issues.push(...lintSemanticConfig(config, origins))
  return { config, issues, origins }
}
