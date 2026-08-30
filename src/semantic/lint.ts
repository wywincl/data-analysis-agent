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
 * Deliberately NOT checked: the contents of `filters`. They are free-form SQL
 * predicates by design (trusted, operator-authored, `status = 'paid'` up to
 * `dt >= date_sub(now(), interval 7 day)`), and guessing column names out of
 * them with a regex would produce more false positives than real catches.
 *
 * @module dsh-data-analysis/semantic/lint
 */

import { tpl } from '../i18n/index.ts'
import { en, zh, type HostLocale } from '../i18n/host.ts'
import type { LintIssue, LintIssueView, SemanticConfig, SemanticEntity } from './types.ts'

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

/** Report each element of `items` that is missing from `known` (case-insensitive). */
function missing(known: ReadonlySet<string> | undefined, items: readonly string[] | undefined): string[] {
  if (known === undefined || items === undefined) return []
  return items.filter((item) => !known.has(item.toLowerCase()))
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
  for (const metric of metrics) {
    const known = columnsOf.get(metric.entity)
    const where = at(origins, `metric:${metric.name}`, `metrics["${metric.name}"]`)

    const badDimensions = missing(known, metric.dimensions)
    if (badDimensions.length > 0) {
      add('unknown-dimension-column', `${where}.dimensions`, { names: quoteList(badDimensions), entity: metric.entity })
    }

    const duplicates = (metric.dimensions ?? []).filter((name, index) => (metric.dimensions ?? []).indexOf(name) !== index)
    if (duplicates.length > 0) {
      add('duplicate-dimension', `${where}.dimensions`, { names: quoteList([...new Set(duplicates)]) })
    }

    if (metric.measure !== undefined && known !== undefined && !known.has(metric.measure.toLowerCase())) {
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
