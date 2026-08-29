/**
 * Build the workbench-facing semantic summary.
 *
 * Collapses the live {@link SemanticLayer} into a compact, locale-rendered
 * preview the settings card renders (status / counts / metric list / lint
 * issues). The host pushes this into the config via the same channel the
 * connectivity probe uses, so the card re-renders whenever the layer reloads.
 *
 * @module dsh-rd-data-analysis/semantic/summary
 */

import { formatLintIssue } from './lint.ts'
import type { HostLocale } from '../i18n/host.ts'
import type { SemanticLayer } from './layer.ts'
import type { SemanticSummary, SemanticSummaryMetric } from './types.ts'

/** Derive a workbench preview from a live semantic layer. */
export function buildSemanticSummary(layer: SemanticLayer, locale: HostLocale): SemanticSummary {
  const catalog = layer.catalog()
  if (layer.file === undefined) {
    return {
      state: 'empty',
      counts: { entities: 0, metrics: 0, terms: 0 },
      metrics: [], entities: [], terms: [], issues: [], files: [],
    }
  }
  if (catalog.error !== undefined) {
    return {
      state: 'parse-error',
      counts: { entities: 0, metrics: 0, terms: 0 },
      metrics: [], entities: [], terms: [],
      issues: catalog.issues.map((issue) => formatLintIssue(issue, locale)),
      files: catalog.files,
      file: catalog.file,
      error: catalog.error,
    }
  }
  const metrics: SemanticSummaryMetric[] = catalog.metrics.map((metric) => ({
    name: metric.name,
    ...(metric.label !== undefined ? { label: metric.label } : {}),
    entity: metric.entity,
    agg: metric.agg,
    ...(metric.measure !== undefined ? { measure: metric.measure } : {}),
    ...(metric.formula !== undefined ? { formula: metric.formula } : {}),
  }))
  const entities = catalog.entities.map((entity) => ({
    table: entity.table,
    ...(entity.label !== undefined ? { label: entity.label } : {}),
  }))
  const terms = catalog.terms.map((term) => ({ name: term.name, description: term.description }))
  return {
    state: 'ok',
    counts: { entities: entities.length, metrics: metrics.length, terms: terms.length },
    metrics, entities, terms,
    issues: catalog.issues.map((issue) => formatLintIssue(issue, locale)),
    files: catalog.files,
    file: catalog.file,
  }
}
