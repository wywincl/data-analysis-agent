/**
 * Semantic layer runtime: hot-reloadable file-backed store plus the
 * metric → SQL builder.
 *
 * Trust model: the YAML is operator-authored (like the composition patch) —
 * metric `filters` are trusted predicates inserted verbatim; everything the
 * MODEL supplies (metric id, dimension names, dimension values, time range)
 * is validated: dimension names must be declared on the metric, identifiers
 * go through the guard's identifier check, values are bound as escaped
 * literals. The built SQL also passes `guardSelectOnly` before execution.
 *
 * @module dsh-rd-data-analysis/semantic/layer
 */

import { watch, type FSWatcher } from 'node:fs'
import { loadSemanticFile } from './load.ts'
import type { ResolvedMetric, SemanticConfig, SemanticEntity, SemanticMetric } from './types.ts'
import { GuardError, assertSafeIdentifier, quoteIdentifier } from '../sql/guard.ts'
import type { SqlDialect } from '../types.ts'

export interface MetricQuery {
  /** Declared dimensions to group by (must be on the metric). */
  readonly dimensions?: readonly string[]
  /** Equality filters on declared dimensions: { city: '杭州' } or { status: ['paid','pending'] }. */
  readonly filters?: Readonly<Record<string, string | number | boolean | readonly (string | number)[]>>
  /** Inclusive lower bound on the metric's timeField. */
  readonly from?: string
  /** Inclusive upper bound on the metric's timeField. */
  readonly to?: string
  readonly limit?: number
}

export interface BuiltMetricSql {
  readonly sql: string
  readonly datasource: string
  readonly dialect: SqlDialect
  /** Select labels for the projected columns, in order. */
  readonly columns: readonly { name: string, label: string }[]
}

/** Escape one literal value for safe interpolation (numbers/bools raw, strings quoted). */
export function sqlLiteral(value: string | number | boolean, dialect: SqlDialect): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return dialect === 'postgresql' || dialect === 'hive' ? value.toString() : value ? '1' : '0'
  // Single-quote escaping covers mysql/postgresql/sqlite/hive string literals.
  return `'${value.replace(/'/g, "''")}'`
}

export class SemanticLayer {
  private config: SemanticConfig = {}
  private watcher: FSWatcher | undefined
  private reloadTimer: NodeJS.Timeout | undefined
  private lastError: string | undefined

  constructor(
    public file: string | undefined,
    private readonly onReload: (layer: SemanticLayer) => void = () => {},
  ) {
    this.reloadSync()
  }

  /** Current config (never throws — a broken file keeps the last good one). */
  get(): SemanticConfig {
    return this.config
  }

  /** Last reload error, if the current file failed to load. */
  get error(): string | undefined {
    return this.lastError
  }

  /** Point at a new file (or none) and reload; wires the fs watcher. */
  reconfigure(file: string | undefined): void {
    this.file = file === '' ? undefined : file
    this.watcher?.close()
    this.watcher = undefined
    this.reloadSync()
    if (this.file !== undefined) {
      try {
        this.watcher = watch(this.file, () => {
          clearTimeout(this.reloadTimer)
          // Editors emit multiple events per save; collapse to one reload.
          this.reloadTimer = setTimeout(() => {
            this.reloadSync()
            this.onReload(this)
          }, 300)
        })
      } catch { /* file may not exist yet; /data-reload covers it */ }
    }
  }

  /** Force a reload (also used by /data-reload). Returns the error if any. */
  reload(): string | undefined {
    this.reloadSync()
    return this.lastError
  }

  /** Release the fs watcher (plugin unload / registry rewire). */
  dispose(): void {
    clearTimeout(this.reloadTimer)
    this.watcher?.close()
    this.watcher = undefined
  }

  private reloadSync(): void {
    if (this.file === undefined) {
      this.config = {}
      this.lastError = undefined
      return
    }
    try {
      this.config = loadSemanticFile(this.file)
      this.lastError = undefined
    } catch (error) {
      // Keep the last good config; surface the reason through tools/commands.
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** Resolve a metric id to metric + entity + effective datasource. */
  resolveMetric(name: string): ResolvedMetric {
    const metric = this.config.metrics?.find((entry) => entry.name === name)
    if (metric === undefined) {
      const known = (this.config.metrics ?? []).map((entry) => entry.name).join(', ') || '(none)'
      throw new GuardError(`Unknown metric "${name}". Defined: ${known}. See list_semantic.`)
    }
    const entity = this.config.entities?.find((entry) => entry.table === metric.entity)
    if (entity === undefined) throw new GuardError(`Metric "${name}" references unknown entity "${metric.entity}".`)
    const datasource = metric.datasource ?? entity.datasource ?? this.config.defaults?.datasource
    if (datasource === undefined) throw new GuardError(`Metric "${name}" has no datasource (metric/entity/defaults).`)
    return { metric, entity, datasource }
  }

  /** All metrics with their resolved datasource + entity label (catalog view). */
  catalog(): {
    metrics: (SemanticMetric & { resolvedDatasource: string, entityLabel?: string })[]
    entities: SemanticEntity[]
    terms: NonNullable<SemanticConfig['terms']>
    error?: string
    file?: string
  } {
    const metrics = (this.config.metrics ?? []).map((metric) => {
      try {
        const resolved = this.resolveMetric(metric.name)
        const entityLabel = resolved.entity.label
        return { ...metric, resolvedDatasource: resolved.datasource, ...(entityLabel !== undefined ? { entityLabel } : {}) }
      } catch {
        return { ...metric, resolvedDatasource: '(unresolved)' }
      }
    })
    return {
      metrics,
      entities: this.config.entities ?? [],
      terms: this.config.terms ?? [],
      ...(this.lastError !== undefined ? { error: this.lastError } : {}),
      ...(this.file !== undefined ? { file: this.file } : {}),
    }
  }

  /** Column business label lookup for one table (inspect_schema overlay). */
  entityFor(table: string): SemanticEntity | undefined {
    return this.config.entities?.find((entry) => entry.table === table)
  }

  /** Terms + metrics digest for the system prompt (compact). */
  promptDigest(): string {
    const parts: string[] = []
    if ((this.config.terms?.length ?? 0) > 0) {
      parts.push('Business terms (统一口径):\n' + (this.config.terms ?? [])
        .map((term) => `- ${term.name}${term.aliases?.length ? ` (aka ${term.aliases.join('/')})` : ''}: ${term.description}`)
        .join('\n'))
    }
    if ((this.config.metrics?.length ?? 0) > 0) {
      parts.push('Governed metrics (prefer query_metric over hand-written SQL):\n' + (this.config.metrics ?? [])
        .map((metric) => {
          const dims = metric.dimensions?.length ? ` dims: ${metric.dimensions.join('/')}` : ''
          const time = metric.timeField !== undefined ? ` time: ${metric.timeField}` : ''
          return `- ${metric.name} — ${metric.label ?? metric.name}: ${metric.agg}(${metric.measure ?? '*'}) on ${metric.entity}${time}${dims}${metric.unit !== undefined ? ` (${metric.unit})` : ''}`
        })
        .join('\n'))
    }
    return parts.join('\n\n')
  }

  /**
   * Build the metric SQL. Throws GuardError on unknown ids, undeclared
   * dimensions, or bad identifiers.
   */
  buildMetricSql(metricName: string, query: MetricQuery = {}, dialect: SqlDialect = 'sqlite'): BuiltMetricSql {
    const { metric, entity, datasource } = this.resolveMetric(metricName)
    const table = quoteIdentifier(assertSafeIdentifier(entity.table, 'entity table'), dialect)

    const declared = metric.dimensions ?? []
    const requested = query.dimensions ?? []
    for (const dimension of requested) {
      if (!declared.includes(dimension)) {
        throw new GuardError(`Dimension "${dimension}" is not declared on metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
      }
    }
    for (const key of Object.keys(query.filters ?? {})) {
      if (!declared.includes(key)) {
        throw new GuardError(`Filter key "${key}" is not a declared dimension of metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
      }
    }
    if ((query.from !== undefined || query.to !== undefined) && metric.timeField === undefined) {
      throw new GuardError(`Metric "${metric.name}" declares no timeField — from/to unsupported.`)
    }

    const aggExpr = metric.agg === 'count'
      ? 'COUNT(*)'
      : metric.agg === 'count_distinct'
        ? `COUNT(DISTINCT ${quoteIdentifier(assertSafeIdentifier(metric.measure!, 'measure'), dialect)})`
        : `${metric.agg.toUpperCase()}(${quoteIdentifier(assertSafeIdentifier(metric.measure!, 'measure'), dialect)})`
    const valueLabel = metric.label ?? metric.name

    const selectParts: string[] = []
    const groupParts: string[] = []
    const columns: { name: string, label: string }[] = []
    for (const dimension of requested) {
      const quoted = quoteIdentifier(assertSafeIdentifier(dimension, 'dimension'), dialect)
      selectParts.push(`${quoted} AS ${quoteIdentifier(dimension, dialect)}`)
      groupParts.push(quoted)
      const columnMeta = entity.columns?.find((column) => column.name === dimension)
      columns.push({ name: dimension, label: columnMeta?.label ?? dimension })
    }
    if (requested.length === 0 && metric.timeField !== undefined) {
      const time = quoteIdentifier(assertSafeIdentifier(metric.timeField, 'timeField'), dialect)
      selectParts.push(`${time} AS ${quoteIdentifier(metric.timeField, dialect)}`)
      groupParts.push(time)
      columns.push({ name: metric.timeField, label: '时间' })
    }
    selectParts.push(`${aggExpr} AS ${quoteIdentifier('value', dialect)}`)
    columns.push({ name: 'value', label: valueLabel })

    const whereParts: string[] = [...(metric.filters ?? [])]
    for (const [key, raw] of Object.entries(query.filters ?? {})) {
      const quoted = quoteIdentifier(assertSafeIdentifier(key, 'filter dimension'), dialect)
      if (Array.isArray(raw)) {
        if (raw.length === 0) continue
        const literals = (raw as readonly (string | number)[]).map((value) => sqlLiteral(value, dialect)).join(', ')
        whereParts.push(`${quoted} IN (${literals})`)
      } else {
        whereParts.push(`${quoted} = ${sqlLiteral(raw as string | number | boolean, dialect)}`)
      }
    }
    if (query.from !== undefined && metric.timeField !== undefined) {
      whereParts.push(`${quoteIdentifier(metric.timeField, dialect)} >= ${sqlLiteral(query.from, dialect)}`)
    }
    if (query.to !== undefined && metric.timeField !== undefined) {
      whereParts.push(`${quoteIdentifier(metric.timeField, dialect)} <= ${sqlLiteral(query.to, dialect)}`)
    }

    const limit = Math.min(Math.max(query.limit ?? 500, 1), 5000)
    const where = whereParts.length > 0 ? `\nWHERE ${whereParts.join('\n  AND ')}` : ''
    const groupBy = groupParts.length > 0 ? `\nGROUP BY ${groupParts.join(', ')}` : ''
    const orderBy = groupParts.length > 0
      ? requested.length > 0
        ? '\nORDER BY value DESC'
        : `\nORDER BY ${groupParts[0]} ASC`
      : ''
    const sql = `SELECT ${selectParts.join(', ')}\nFROM ${table}${where}${groupBy}${orderBy}\nLIMIT ${limit}`
    return { sql, datasource, dialect, columns }
  }
}
