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
 * @module dsh-rd-data-analysis/semantic/types
 */

/** Aggregations a metric may apply to its measure. */
export type MetricAgg = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_distinct'

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
  }[]
}

/** TERM: one business term with aliases for口径 consistency. */
export interface SemanticTerm {
  name: string
  aliases?: string[]
  description: string
}

/** METRIC: one executable, governed metric definition. */
export interface SemanticMetric extends SemanticInherited {
  /** Stable id the model references in query_metric. */
  name: string
  label?: string
  description?: string
  /** Entity (table) this metric aggregates; must exist in `entities`. */
  entity: string
  /** Measure column; required for every agg except `count`. */
  measure?: string
  agg: MetricAgg
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

export const METRIC_AGGS: readonly MetricAgg[] = ['sum', 'count', 'avg', 'min', 'max', 'count_distinct']

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

/** One non-fatal problem found in an otherwise loadable semantic config. */
export interface LintIssue {
  severity: LintSeverity
  code: LintCode
  /** Where it came from, e.g. `demo/metrics.yaml: metrics[2].dimensions[0]`. */
  path: string
  message: string
  /** Suggested fix, when there is an obvious one. */
  hint?: string
}
