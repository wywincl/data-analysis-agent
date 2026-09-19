/**
 * Semantic layer health check (语义层体检).
 *
 * `load.ts` validates syntax and structure; this module validates *meaning*.
 * Everything it finds is a **warning** — the config still loads and keeps
 * serving queries, because a half-governed catalog beats no catalog, and
 * blocking a reload over a typo would take the whole analysis layer down.
 *
 * ### Issues are data, not prose
 *
 * `lintSemanticConfig` emits `code` + `params` and never a sentence. Wording
 * lives in the i18n dictionary and is applied by {@link formatLintIssue} at
 * render time, which buys two things: this file stays free of any locale or
 * `config` dependency, and switching the UI language re-labels existing issues
 * without reloading the semantic layer.
 *
 * Deliberately NOT checked: the contents of `filters` in general. They are
 * free-form SQL predicates by design (trusted, operator-authored,
 * `status = 'paid'` up to `dt >= date_sub(now(), interval 7 day)`), and
 * guessing column names out of them with a regex would produce more false
 * positives than real catches. The one narrow exception is the declared
 * enum domain: when a column carries `values`, an `= 'x'` / `IN (…)`
 * comparison against it is checked against that domain — the config
 * explicitly promised those values, so the check is precise, not a guess.
 *
 * @module dsh-data-analysis/semantic/lint
 */

import { tpl } from '../i18n/index.ts'
import { en, zh, type HostLocale } from '../i18n/host.ts'
import type { LintIssue, LintIssueView, SemanticConfig, SemanticEntity, SemanticMetric } from './types.ts'

/** Provenance map from compose.ts: `metric:<name>` / `entity:<table>` / `term:<name>` → file. */
type Origins = Readonly<Record<string, string>>

export function hostStrings(locale: HostLocale): typeof zh {
  return locale === 'en' ? en : zh
}

/** Render one issue's message and hint in the given locale. */
export function formatLintIssue(issue: LintIssue, locale: HostLocale): LintIssueView {
  const s = hostStrings(locale)
  const message = tpl(s[`lint.${issue.code}.message`], issue.params)
  const hint = s[`lint.${issue.code}.hint`]
  return {
    severity: issue.severity,
    code: issue.code,
    path: issue.path,
    message: message ?? issue.code,
    ...(hint !== undefined ? { hint: tpl(hint, issue.params) } : {}),
  }
}

/** Render a whole issue list. Convenience wrapper used by tools and commands. */
export function formatLintIssues(issues: readonly LintIssue[], locale: HostLocale): LintIssueView[] {
  return issues.map((issue) => formatLintIssue(issue, locale))
}

/** Prefix a definition path with the file it came from, when known. */
function at(origins: Origins, key: string, path: string): string {
  const file = origins[key]
  return file === undefined ? path : `${file}: ${path}`
}

function columnNames(entity: SemanticEntity | undefined): ReadonlySet<string> | undefined {
  if (entity?.columns === undefined) return undefined
  return new Set(entity.columns.map((column) => column.name.toLowerCase()))
}

/** Quote a list of identifiers for interpolation into a message. */
function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(', ')
}

/**
 * Run every rule over a composed config. Pure — no I/O, no throwing, no locale.
 * @param origins optional provenance, used to prefix `path` with the source file.
 */
export function lintSemanticConfig(config: SemanticConfig, origins: Origins = {}): LintIssue[] {
  const issues: LintIssue[] = []
  const columnsOf = new Map<string, ReadonlySet<string> | undefined>(
    (config.entities ?? []).map((entity) => [entity.table, columnNames(entity)]),
  )
  const metrics = config.metrics ?? []
  const terms = config.terms ?? []
  const termKey = (name: string): string => name.trim().toLowerCase()

  const add = (code: LintIssue['code'], path: string, params: Record<string, string | number>): void => {
    issues.push({ severity: 'warning', code, path, params })
  }

  // --- per-metric column checks -------------------------------------------
  // Enum domains per entity: column name → declared values (string form).
  const enumOf = new Map<string, ReadonlyMap<string, string>>()
  for (const entity of config.entities ?? []) {
    const declared = (entity.columns ?? []).filter((column) => column.values !== undefined)
    if (declared.length === 0) continue
    const domains = new Map<string, string>()
    for (const column of declared) {
      const values = (column.values ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.value))
      domains.set(column.name.toLowerCase(), values.join('|'))
    }
    enumOf.set(entity.table, domains)
  }

  /**
   * Column references may be qualified (`users.city`) when the metric joins
   * that entity — resolve against the named entity instead of the metric's own.
   */
  const columnExists = (metric: SemanticMetric, ref: string): boolean => {
    const dot = ref.indexOf('.')
    const target = dot === -1 ? metric.entity : ref.slice(0, dot)
    const column = dot === -1 ? ref : ref.slice(dot + 1)
    return columnsOf.get(target)?.has(column.toLowerCase()) ?? false
  }

  for (const metric of metrics) {
    const known = columnsOf.get(metric.entity)
    const where = at(origins, `metric:${metric.name}`, `metrics["${metric.name}"]`)
    const enums = enumOf.get(metric.entity)

    const badDimensions = (metric.dimensions ?? []).filter((ref) => !columnExists(metric, ref))
    if (badDimensions.length > 0) {
      add('unknown-dimension-column', `${where}.dimensions`, { names: quoteList(badDimensions), entity: metric.entity })
    }

    const duplicates = (metric.dimensions ?? []).filter((name, index) => (metric.dimensions ?? []).indexOf(name) !== index)
    if (duplicates.length > 0) {
      add('duplicate-dimension', `${where}.dimensions`, { names: quoteList([...new Set(duplicates)]) })
    }

    if (metric.measure !== undefined && known !== undefined && !columnExists(metric, metric.measure)) {
      add('unknown-measure-column', `${where}.measure`, { column: metric.measure, entity: metric.entity })
    }

    if (metric.timeField !== undefined && known !== undefined && !known.has(metric.timeField.toLowerCase())) {
      add('unknown-timefield-column', `${where}.timeField`, { column: metric.timeField, entity: metric.entity })
    }

    if (metric.agg === 'count' && metric.measure !== undefined) {
      add('count-with-measure', `${where}.measure`, { measure: metric.measure })
    }

    if (metric.timeField === undefined && (metric.filters ?? []).length === 0) {
      add('unbounded-metric', where, {})
    }

    // Declared enum domains: check simple `col = 'v'` / `col IN ('a','b')`
    // comparisons inside this metric's filters. Unqualified columns only —
    // `Entity.column` qualified references are out of reach of this cheap
    // check by design.
    if (enums !== undefined) {
      const reported = new Set<string>()
      for (const predicate of metric.filters ?? []) {
        // Split on the AND/OR connectors so each comparison is judged alone.
        const fragments = predicate.split(/\s+(?:and|or)\s+/i)
        for (const fragment of fragments) {
          for (const [column, domain] of enums) {
            const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            if (!new RegExp(`^\\s*${escaped}\\s*(?:=|in\\s*\\()`, 'i').test(fragment)) continue
            const domainValues = domain.split('|')
            for (const match of fragment.matchAll(/['"]([a-z0-9_-]+)['"]/gi)) {
              const value = match[1]!
              if (domainValues.includes(value)) continue
              const key = `${column}:${value}`
              if (reported.has(key)) continue
              reported.add(key)
              add('enum-filter-value-unknown', `${where}.filters`, {
                column, value, entity: metric.entity, values: domain,
              })
            }
          }
        }
      }
    }
  }

  // --- per-entity structural checks ----------------------------------------
  for (const entity of config.entities ?? []) {
    const known = columnsOf.get(entity.table)
    const where = at(origins, `entity:${entity.table}`, `entities["${entity.table}"]`)
    if (entity.key !== undefined && known !== undefined && !known.has(entity.key.toLowerCase())) {
      add('unknown-key-column', `${where}.key`, { column: entity.key, entity: entity.table })
    }
    for (const relationship of entity.relationships ?? []) {
      if (known !== undefined && !known.has(relationship.on[0].toLowerCase())) {
        add('relationship-column-missing', `${where}.relationships`, {
          entity: entity.table, column: relationship.on[0], target: relationship.entity,
        })
      }
    }
  }

  // --- terminology collisions ---------------------------------------------
  const termOwners = new Map<string, string>()
  for (const term of terms) {
    const names = [term.name, ...(term.aliases ?? [])].map(termKey)
    for (const name of names) {
      const owner = termOwners.get(name)
      if (owner !== undefined && owner !== term.name) {
        add('term-alias-collision', at(origins, `term:${term.name}`, `terms["${term.name}"]`), {
          term: term.name, name, owner,
        })
      }
      termOwners.set(name, term.name)
    }
  }

  for (const metric of metrics) {
    const owner = termOwners.get(termKey(metric.name))
    if (owner !== undefined) {
      add('metric-shadows-term', at(origins, `metric:${metric.name}`, `metrics["${metric.name}"]`), {
        metric: metric.name, term: owner,
      })
    }
  }

  // --- catalog readability (aggregated, one line each) ---------------------
  const unlabeled = metrics.filter((metric) => metric.label === undefined).map((metric) => metric.name)
  if (unlabeled.length > 0) {
    const shown = unlabeled.slice(0, 8).join(', ')
    add('missing-label', 'metrics', { count: unlabeled.length, names: unlabeled.length > 8 ? `${shown}, …` : shown })
  }

  return issues
}
