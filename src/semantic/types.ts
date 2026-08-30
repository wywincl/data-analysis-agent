/**
 * Semantic layer (语义层) configuration types.
 *
 * Design vocabulary follows the reference data-agent's Catalog semantics
 * (meaning / term / metric), expressed as a declarative, version-controllable
 * YAML file instead of a scan+review pipeline:
 *
 * - `entities` → MEANING: business labels/descriptions overlaid onto physical
 *   tables and columns (what inspect_schema reports, what the model sees);
 * - `terms` → TERM: business vocabulary with aliases, injected into the
 *   system prompt so口径 stay consistent;
 * - `metrics` → METRIC: executable metric definitions — entity + measure +
 *   aggregation + fixed filters + grain + time field — that `query_metric`
 *   turns into guarded SQL.
 *
 * ### Composition (added later, see compose.ts)
 *
 * The layer is no longer one flat file. A root file may `include` other files
 * (globs and directories), and definitions flow down three inheritance axes:
 *
 * ```
 * defaults   ─┐
 * entity     ─┼─→ metric        (filters ACCUMULATE, everything else overrides)
 * extends    ─┘
 * ```
 *
 * Precedence, lowest to highest: `defaults` → `entity` → `extends` chain
 * (root base → direct base) → the metric itself. `filters` is the exception:
 * every level is AND-ed together, so widening a base口径 can never silently
 * drop a constraint that a child added.
 *
 * The files are operator-authored (trusted config, same trust model as the
 * composition patch); the model may only reference ids and bind literal
 * values. @see include.ts for file composition, @see compose.ts for merge and
 * inheritance, @see lint.ts for the post-load health check.
 *
 * @module dsh-data-analysis/semantic/types
 */

/** Aggregations a metric may apply to its measure. */
export type MetricAgg = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_distinct' | 'ratio' | 'expression'

/**
 * Fields every level of the hierarchy may contribute downward. Declared once
 * on `defaults`, optionally refined per entity, optionally refined per metric.
 */
export interface SemanticInherited {
  /** Datasource the table lives in; falls back to `defaults.datasource`. */
  datasource?: string
  /** Default time column for from/to range filters. */
  timeField?: string
  /** 口径 predicates always AND-ed in for every metric below this level. */
  filters?: string[]
  /** Columns the model may group by or filter on. */
  dimensions?: string[]
}

/** Root-level defaults, inherited by every entity and metric. */
export interface SemanticDefaults extends SemanticInherited {}

/** A foreign key from this entity to a related entity, enabling cross-table metrics. */
export interface SemanticRelationship {
  /** Related entity (table) name; must resolve to a defined `entities` entry. */
  entity: string
  /** `[thisColumn, relatedColumn]` — the join condition (both validated identifiers). */
  on: [string, string]
}

/** MEANING: one physical table plus its business labels. */
export interface SemanticEntity extends SemanticInherited {
  /** Physical table name (validated identifier). */
  table: string
  /** Business name, e.g. 订单表. */
  label?: string
  /** One-paragraph business description shown to the model. */
  description?: string
  /** Column-level business labels overlaid onto introspection. */
  columns?: {
    name: string
    label?: string
    description?: string
    unit?: string
    /** Mark PII/sensitive columns — masked in results unless the role may read them. */
    sensitive?: boolean
  }[]
  /** Foreign keys to other entities; lets a metric join across tables. */
  relationships?: SemanticRelationship[]
  /**
   * Row-level security predicate AND-ed into every query on this entity.
   * The literal `{role}` is replaced with the configured `currentRole`
   * (`config.currentRole`). Trusted (operator-authored) SQL.
   */
  rowFilter?: string
  /** Roles allowed to read this entity's sensitive columns and skip `rowFilter`. */
  readRoles?: string[]
}

/** TERM: one business term with aliases for口径 consistency. */
export interface SemanticTerm {
  name: string
  aliases?: string[]
  description: string
}

/** One side of a ratio metric: an inline aggregate or a reference to another metric. */
export interface MetricRef {
  /** Metric id to reuse (its entity/agg/measure/filters are inlined). */
  metric?: string
  /** Override the entity (table) for an inline aggregate. */
  entity?: string
  /** Measure column for an inline aggregate. */
  measure?: string
  agg?: MetricAgg
  /** Extra口径 predicates AND-ed into this side only. */
  filters?: string[]
}

/** METRIC: one executable, governed metric definition. */
export interface SemanticMetric extends SemanticInherited {
  /** Stable id the model references in query_metric. */
  name: string
  label?: string
  description?: string
  /** Entity (table) this metric aggregates; must exist in `entities`. */
  entity: string
  /** Measure column; required for every agg except `count`/`ratio`/`expression`. */
  measure?: string
  agg: MetricAgg
  /**
   * `ratio` → `numerator`/`denominator` (metric refs or inline aggregates)
   * combined as num / NULLIF(den, 0). `expression` → `expression` is used
   * verbatim as the aggregate (trusted, operator-authored SQL fragment).
   */
  numerator?: MetricRef
  denominator?: MetricRef
  /** Trusted SQL expression used as the measure when `agg === 'expression'`. */
  expression?: string
  /**
   * Related entities to JOIN into the metric (names must be reachable from
   * this entity via `relationships`). Dimensions/filters/measure may then
   * reference joined columns as `Entity.column`.
   */
  joins?: string[]
  /**
   * Inherit from another metric by name. The base contributes everything the
   * metric does not declare itself; `filters` from both are AND-ed. Resolved
   * away during composition — a composed config never carries `extends`.
   */
  extends?: string
  /** Human-readable口径 formula, informational (shown in the catalog). */
  formula?: string
  /** Grain note, e.g. 按天 / 按订单. */
  grain?: string
  unit?: string
}

export interface SemanticConfig {
  defaults?: SemanticDefaults
  entities?: SemanticEntity[]
  terms?: SemanticTerm[]
  metrics?: SemanticMetric[]
}

export const METRIC_AGGS: readonly MetricAgg[] = ['sum', 'count', 'avg', 'min', 'max', 'count_distinct', 'ratio', 'expression']

/** One resolved metric lookup (metric + its entity + effective datasource). */
export interface ResolvedMetric {
  readonly metric: SemanticMetric
  readonly entity: SemanticEntity
  readonly datasource: string
}

// ---------------------------------------------------------------------------
// Post-load health check (lint)
// ---------------------------------------------------------------------------

/** Lint severities. Only `warning` today — lint never blocks a load. */
export type LintSeverity = 'warning'

/** Stable issue codes so operators can grep, document, or suppress them. */
export type LintCode =
  | 'duplicate-definition'
  | 'unknown-dimension-column'
  | 'unknown-measure-column'
  | 'unknown-timefield-column'
  | 'duplicate-dimension'
  | 'count-with-measure'
  | 'term-alias-collision'
  | 'metric-shadows-term'
  | 'unbounded-metric'
  | 'missing-label'
  | 'unknown-relationship-entity'
  | 'relationship-column-missing'
  | 'unknown-join-entity'
  | 'join-unreachable'
  | 'ratio-missing-sides'
  | 'ratio-unknown-metric'
  | 'expression-missing'
  | 'drift-table-missing'
  | 'drift-column-missing'

/**
 * One non-fatal problem found in an otherwise loadable semantic config.
 *
 * Issues carry **data, not prose**: `code` + `params` are resolved against the
 * i18n dictionary by `formatLintIssue()` at render time. That keeps lint.ts
 * locale-agnostic (it never sees `config`) and means switching the UI language
 * takes effect immediately instead of needing a semantic reload.
 */
export interface LintIssue {
  severity: LintSeverity
  code: LintCode
  /** Where it came from, e.g. `demo/metrics.yaml: metrics[2].dimensions[0]`. */
  path: string
  /** Values interpolated into the `lint.<code>.message` / `.hint` template. */
  params: Readonly<Record<string, string | number>>
}

/** A lint issue with its message and hint rendered in one locale. */
export interface LintIssueView {
  severity: LintSeverity
  code: LintCode
  path: string
  message: string
  hint?: string
}

// ---------------------------------------------------------------------------
// Workbench-facing summary (read-only preview + editor read-back)
// ---------------------------------------------------------------------------

/** Load state of the semantic layer, surfaced to the workbench card. */
export type SemanticSummaryState = 'ok' | 'empty' | 'missing' | 'parse-error'

/** One metric as shown in the workbench preview (no heavy fields). */
export interface SemanticSummaryMetric {
  name: string
  label?: string
  entity: string
  agg: string
  measure?: string
  formula?: string
}

/** Compact catalog summary pushed to the workbench card for preview. */
export interface SemanticSummary {
  state: SemanticSummaryState
  counts: { entities: number, metrics: number, terms: number }
  metrics: SemanticSummaryMetric[]
  entities: { table: string, label?: string }[]
  terms: { name: string, description: string }[]
  /** Lint findings, already rendered in the operator's locale. */
  issues: LintIssueView[]
  /** All files contributing to the current graph. */
  files: readonly string[]
  /** Resolved semantic file path (root). */
  file?: string
  /** Last load error, if the graph failed to load. */
  error?: string
}
