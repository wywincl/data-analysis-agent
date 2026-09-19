/**
 * Semantic layer runtime: hot-reloadable file-graph store plus the
 * metric → SQL builder. The graph (root file + its `include`s) is watched as a
 * whole, so editing any contributing file reloads the layer; the composed
 * config is what the SQL builder sees, so inheritance never leaks this far.
 *
 * Trust model: the YAML is operator-authored (like the composition patch) —
 * metric `filters` are trusted predicates inserted verbatim; everything the
 * MODEL supplies (metric id, dimension names, dimension values, time range)
 * is validated: dimension names must be declared on the metric, identifiers
 * go through the guard's identifier check, values are bound as escaped
 * literals. The built SQL also passes `guardSelectOnly` before execution.
 *
 * @module dsh-data-analysis/semantic/layer
 */

import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { dirname, sep } from 'node:path'
import { loadSemanticGraph } from './load.ts'
import type { LintIssue, MetricRef, ResolvedMetric, SemanticConfig, SemanticEntity, SemanticMetric } from './types.ts'
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
  /** UI locale for generated column labels (e.g. the auto time column). */
  readonly locale?: 'zh' | 'en'
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
  // Single-quote doubling covers mysql/postgresql/sqlite/hive; mysql and hive
  // additionally treat backslash as an escape character, so a trailing `\`
  // would swallow the closing quote (and with it the rest of the statement).
  const escaped = dialect === 'mysql' || dialect === 'hive'
    ? value.replace(/\\/g, '\\\\').replace(/'/g, "''")
    : value.replace(/'/g, "''")
  return `'${escaped}'`
}

/** The day after a `YYYY-MM-DD` date, for an exclusive upper bound. */
function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d) + 86_400_000)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${mm}-${dd}`
}

export class SemanticLayer {
  private config: SemanticConfig = {}
  private lintIssues: readonly LintIssue[] = []
  /** Root plus every included file the current config was built from. */
  private files: readonly string[] = []
  private watchers: FSWatcher[] = []
  private watchedKey = ''
  private reloadTimer: NodeJS.Timeout | undefined
  /**
   * fs.watch is best-effort (FSEvents coalescing, NFS, container mounts) — a
   * 2s stat/readdir signature poll backs it up so a missed event costs
   * latency, never correctness. unref'd so it never holds the process open.
   */
  private pollTimer: NodeJS.Timeout | undefined
  private lastSignature: string | undefined
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

  /** Last reload error, if the current graph failed to load. */
  get error(): string | undefined {
    return this.lastError
  }

  /** Post-load health check findings. Warnings only — they never block a load. */
  get issues(): readonly LintIssue[] {
    return this.lintIssues
  }

  /** Files currently watched: the root plus its whole include graph. */
  get watchedFiles(): readonly string[] {
    return this.files
  }

  /** Point at a new file (or none) and reload; re-wires the fs watchers. */
  reconfigure(file: string | undefined): void {
    this.file = file === '' ? undefined : file
    this.closeWatchers()
    this.reloadSync()
  }

  /** Force a reload (also used by /data-reload). Returns the error if any. */
  reload(): string | undefined {
    this.reloadSync()
    return this.lastError
  }

  /** Release the fs watchers (plugin unload / registry rewire). */
  dispose(): void {
    clearTimeout(this.reloadTimer)
    clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.closeWatchers()
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
    this.watchedKey = ''
  }

  /**
   * Cheap change fingerprint: per-file mtime+size, plus the directory
   * listings of every watched directory (that is how a *new* file in a
   * globbed directory shows up before any reload knows about it). Missing
   * paths fingerprint as `gone` — deletion is a change too.
   */
  private signatureFor(files: readonly string[]): string {
    const parts: string[] = []
    for (const target of this.watchTargetsFor(files)) {
      try {
        const stats = statSync(target)
        if (stats.isDirectory()) {
          parts.push(`${target}/:${readdirSync(target).sort().join(',')}`)
        } else {
          parts.push(`${target}:${stats.mtimeMs}:${stats.size}`)
        }
      } catch {
        parts.push(`${target}:gone`)
      }
    }
    return parts.join('|')
  }

  /** Poll fallback: reload when the fingerprint drifts from the last one. */
  private pollCheck(): void {
    const files = this.files.length > 0 ? this.files : this.file !== undefined ? [this.file] : []
    if (files.length === 0) return
    if (this.signatureFor(files) === this.lastSignature) return
    clearTimeout(this.reloadTimer)
    // Reuse the event debounce: one coalesced reload, same as a watch event.
    this.reloadTimer = setTimeout(() => {
      this.reloadSync()
      this.onReload(this)
    }, 300)
  }

  /**
   * Files plus the directories above them, up to the root file's directory.
   *
   * File watchers catch edits. Directory watchers are what make `include`
   * globs work: a file-only watcher never fires when a *new* file lands in a
   * globbed directory, so adding `metrics/billing.yaml` would silently not
   * reload. Watching the directories catches create/rename/delete too. The
   * set is re-derived on every reload, so a newly globbed directory starts
   * being watched on the very reload it triggered.
   */
  private watchTargetsFor(files: readonly string[]): string[] {
    const targets = new Set<string>(files)
    if (this.file === undefined) return [...targets].sort()
    const rootDir = dirname(this.file)
    const prefix = rootDir === sep ? sep : rootDir + sep
    targets.add(rootDir)
    for (const file of files) {
      const start = dirname(file)
      if (!(start === rootDir || start.startsWith(prefix))) {
        // Lives outside the root's tree (e.g. `../shared/entities.yaml`):
        // watch that directory, but do not walk the whole filesystem upward.
        targets.add(start)
        continue
      }
      let dir = start
      for (;;) {
        targets.add(dir)
        if (dir === rootDir) break
        dir = dirname(dir)
      }
    }
    return [...targets].sort()
  }

  /**
   * Watch every contributing file, not just the root: editing an included
   * domain file must hot-reload exactly like editing the root does. Re-wired
   * only when the set changes (a new `include`, a renamed file), so a save
   * storm cannot churn watchers.
   */
  private syncWatchers(files: readonly string[]): void {
    const targets = this.watchTargetsFor(files)
    const key = targets.join('\n')
    if (this.pollTimer === undefined) {
      this.pollTimer = setInterval(() => this.pollCheck(), 2000)
      this.pollTimer.unref?.()
    }
    if (key === this.watchedKey) return
    this.closeWatchers()
    this.watchedKey = key
    for (const file of targets) {
      try {
        const watcher = watch(file, () => {
          clearTimeout(this.reloadTimer)
          // Editors emit multiple events per save; collapse to one reload.
          this.reloadTimer = setTimeout(() => {
            this.reloadSync()
            this.onReload(this)
          }, 300)
        })
        // Deleted/renamed targets and EMFILE/EPERM surface as 'error' events;
        // an unhandled one crashes the host process. The 2s poll covers any
        // change a dead watcher misses.
        watcher.on('error', () => { /* poll fallback re-derives the signature */ })
        this.watchers.push(watcher)
      } catch { /* file may not exist yet; /data-reload covers it */ }
    }
  }

  private reloadSync(): void {
    if (this.file === undefined) {
      this.config = {}
      this.lintIssues = []
      this.files = []
      this.lastError = undefined
      this.syncWatchers([])
      return
    }
    try {
      const graph = loadSemanticGraph(this.file)
      this.config = graph.config
      this.lintIssues = graph.issues
      this.files = graph.files
      this.lastError = undefined
    } catch (error) {
      // Keep the last good config; surface the reason through tools/commands.
      this.lastError = error instanceof Error ? error.message : String(error)
    }
    // Watch the graph we just loaded. On failure fall back to the root alone,
    // so fixing (or creating) the file still triggers a reload.
    this.syncWatchers(this.files.length > 0 ? this.files : [this.file])
    // Baseline the poll signature only after watchers are wired, so the very
    // first poll compares against a post-sync fingerprint.
    this.lastSignature = this.signatureFor(this.files.length > 0 ? this.files : this.file !== undefined ? [this.file] : [])
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
    issues: readonly LintIssue[]
    files: readonly string[]
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
      issues: this.lintIssues,
      files: this.files,
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
   * dimensions, or bad identifiers. Supports single-table metrics, cross-table
   * `joins`, `ratio` metrics, `expression` metrics, and row-level security
   * (`rowFilter`) with PII column masking (`sensitive`).
   */
  buildMetricSql(
    metricName: string,
    query: MetricQuery = {},
    dialect: SqlDialect = 'sqlite',
    options: { currentRole?: string } = {},
  ): BuiltMetricSql {
    const { metric, entity, datasource } = this.resolveMetric(metricName)
    if (metric.agg === 'ratio') return this.buildRatioSql(metricName, query, dialect, options)

    const currentRole = options.currentRole

    const baseAlias = entity.table
    const joinGraph = this.resolveJoinGraph(baseAlias, metric.joins ?? [])
    const inScope = [baseAlias, ...joinGraph.map((entry) => entry.table)]
    const mayRead = (table: string): boolean => {
      if (currentRole === undefined) return false
      const found = this.config.entities?.find((entry) => entry.table === table)
      return found?.readRoles?.includes(currentRole) ?? false
    }
    const isSensitive = (table: string, column: string): boolean => {
      const found = this.config.entities?.find((entry) => entry.table === table)
      return found?.columns?.some((columnMeta) => columnMeta.name === column && columnMeta.sensitive === true) ?? false
    }
    const refOf = (ref: string): { alias: string, column: string } => {
      if (ref.includes('.')) {
        const [table, column] = ref.split('.')
        if (!inScope.includes(table)) {
          throw new GuardError(`列引用 "${ref}" 的表 "${table}" 不在指标 "${metric.name}" 的作用域(${inScope.join('/')})`)
        }
        return { alias: table, column }
      }
      for (const table of inScope) {
        const found = this.config.entities?.find((entry) => entry.table === table)
        if (found && (found.columns?.some((columnMeta) => columnMeta.name === ref) || (found.dimensions ?? []).includes(ref))) {
          return { alias: table, column: ref }
        }
      }
      return { alias: baseAlias, column: ref }
    }
    /**
     * Qualify a column with its table alias. The alias is emitted UNQUOTED
     * (`orders."amount"`) on purpose: node-sql-parser's sqlite/postgresql/hive
     * dialects cannot parse a double-quoted *qualifier* (`"orders"."amount"`),
     * so a quoted alias would make every generated query fail the read-only
     * guard. The column itself is still quoted per dialect for reserved-word
     * safety. The alias always equals the table name, so dotted refs in the
     * YAML (`users.city`) resolve to the same alias used here.
     */
    const qualifyExpr = (alias: string, column: string): string => `${alias}.${quoteIdentifier(column, dialect)}`
    /** Resolve a column ref to a possibly-masked SQL fragment. */
    const colExpr = (ref: string, allowMask = true): string => {
      const resolved = refOf(ref)
      const masked = allowMask && isSensitive(resolved.alias, resolved.column) && !mayRead(resolved.alias)
      return masked ? 'NULL' : qualifyExpr(resolved.alias, resolved.column)
    }

    const declared = metric.dimensions ?? []
    const requested = query.dimensions ?? []
    // A dimension may be passed qualified as `<table>.<column>` to disambiguate
    // a column that lives on a joined table; accept it when the base column is
    // a declared dimension. `refOf` resolves the qualified form downstream.
    const baseName = (name: string): string => (name.includes('.') ? name.split('.')[1] : name)
    for (const dimension of requested) {
      if (!declared.includes(baseName(dimension))) {
        throw new GuardError(`Dimension "${dimension}" is not declared on metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
      }
    }
    for (const key of Object.keys(query.filters ?? {})) {
      if (!declared.includes(baseName(key))) {
        throw new GuardError(`Filter key "${key}" is not a declared dimension of metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
      }
    }
    if ((query.from !== undefined || query.to !== undefined) && metric.timeField === undefined) {
      throw new GuardError(`Metric "${metric.name}" declares no timeField — from/to unsupported.`)
    }

    let aggExpr: string
    if (metric.agg === 'expression') {
      if (metric.expression === undefined) throw new GuardError(`Metric "${metric.name}" uses agg "expression" but has no expression.`)
      aggExpr = metric.expression
    } else if (metric.agg === 'count') {
      aggExpr = 'COUNT(*)'
    } else if (metric.agg === 'count_distinct') {
      aggExpr = `COUNT(DISTINCT ${colExpr(assertSafeIdentifier(metric.measure!, 'measure'))})`
    } else {
      aggExpr = `${metric.agg.toUpperCase()}(${colExpr(assertSafeIdentifier(metric.measure!, 'measure'))})`
    }
    const valueLabel = metric.label ?? metric.name

    const selectParts: string[] = []
    const groupParts: string[] = []
    const columns: { name: string, label: string }[] = []
    for (const dimension of requested) {
      const resolved = refOf(assertSafeIdentifier(dimension, 'dimension'))
      const masked = isSensitive(resolved.alias, resolved.column) && !mayRead(resolved.alias)
      selectParts.push(`${masked ? 'NULL' : qualifyExpr(resolved.alias, resolved.column)} AS ${quoteIdentifier(dimension, dialect)}`)
      groupParts.push(qualifyExpr(resolved.alias, resolved.column))
      const columnMeta = this.config.entities?.find((entry) => entry.table === resolved.alias)?.columns?.find((columnInfo) => columnInfo.name === resolved.column)
      columns.push({ name: dimension, label: columnMeta?.label ?? dimension })
    }
    if (requested.length === 0 && metric.timeField !== undefined) {
      const resolved = refOf(assertSafeIdentifier(metric.timeField, 'timeField'))
      selectParts.push(`${qualifyExpr(resolved.alias, resolved.column)} AS ${quoteIdentifier(metric.timeField, dialect)}`)
      groupParts.push(qualifyExpr(resolved.alias, resolved.column))
      columns.push({ name: metric.timeField, label: query.locale === 'en' ? 'time' : '时间' })
    }
    selectParts.push(`${aggExpr} AS ${quoteIdentifier('value', dialect)}`)
    columns.push({ name: 'value', label: valueLabel })

    const fromClause = `${quoteIdentifier(baseAlias, dialect)} AS ${baseAlias}`
    const joinClauses = joinGraph.map((entry) =>
      `JOIN ${quoteIdentifier(entry.table, dialect)} AS ${entry.table} ON ${entry.parentAlias}.${quoteIdentifier(entry.parentCol, dialect)} = ${entry.table}.${quoteIdentifier(entry.thisCol, dialect)}`)

    const whereParts: string[] = [...(metric.filters ?? [])]
    for (const [key, raw] of Object.entries(query.filters ?? {})) {
      const column = colExpr(assertSafeIdentifier(key, 'filter dimension'))
      if (Array.isArray(raw)) {
        if (raw.length === 0) continue
        const literals = (raw as readonly (string | number)[]).map((value) => sqlLiteral(value, dialect)).join(', ')
        whereParts.push(`${column} IN (${literals})`)
      } else {
        whereParts.push(`${column} = ${sqlLiteral(raw as string | number | boolean, dialect)}`)
      }
    }
    if (query.from !== undefined && metric.timeField !== undefined) {
      whereParts.push(`${colExpr(assertSafeIdentifier(metric.timeField, 'timeField'))} >= ${sqlLiteral(query.from, dialect)}`)
    }
    if (query.to !== undefined && metric.timeField !== undefined) {
      const timeCol = colExpr(assertSafeIdentifier(metric.timeField, 'timeField'))
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
        // Date-only bound on a DATETIME/TIMESTAMP column: `<= '2026-03-01'`
        // would exclude everything after midnight — cover the whole day.
        whereParts.push(`${timeCol} < ${sqlLiteral(nextDay(query.to), dialect)}`)
      } else {
        whereParts.push(`${timeCol} <= ${sqlLiteral(query.to, dialect)}`)
      }
    }
    if (currentRole !== undefined && entity.rowFilter !== undefined && !mayRead(baseAlias)) {
      // The YAML predicate is operator-authored (trusted, like metric.filters)
      // and already supplies the literal delimiters, e.g. `tenant_id = '{role}'`.
      // Substitute the raw role value (with embedded quotes escaped) so we do
      // not double-wrap it — sqlLiteral() would add its own quotes and produce
      // `tenant_id = ''acme''`. The role is still quoted-injection-safe here.
      whereParts.push(entity.rowFilter.replace(/\{role\}/g, currentRole.replace(/'/g, "''")))
    }

    const rawLimit = query.limit
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit! : 500, 1), 5000)
    const where = whereParts.length > 0 ? `\nWHERE ${whereParts.join('\n  AND ')}` : ''
    const groupBy = groupParts.length > 0 ? `\nGROUP BY ${groupParts.join(', ')}` : ''
    const orderBy = groupParts.length > 0
      ? requested.length > 0
        ? '\nORDER BY value DESC'
        : `\nORDER BY ${groupParts[0]} ASC`
      : ''
    const fromBlock = [fromClause, ...joinClauses].join('\n')
    const sql = `SELECT ${selectParts.join(', ')}\nFROM ${fromBlock}${where}${groupBy}${orderBy}\nLIMIT ${limit}`
    return { sql, datasource, dialect, columns }
  }

  /**
   * Resolve the ordered JOIN list for a metric's `joins`. Includes any
   * intermediate tables on the path so multi-hop relationships work. Each entry
   * carries the parent (already-included) alias and the FK columns.
   */
  private resolveJoinGraph(baseTable: string, requestedJoins: readonly string[]): { table: string, parentAlias: string, parentCol: string, thisCol: string }[] {
    const edgesOf = (table: string): { to: string, fromCol: string, toCol: string }[] => {
      const entity = this.config.entities?.find((entry) => entry.table === table)
      return (entity?.relationships ?? []).map((relationship) => ({ to: relationship.entity, fromCol: relationship.on[0], toCol: relationship.on[1] }))
    }
    const included = new Set<string>([baseTable])
    const needed = new Set(requestedJoins)
    for (let changed = true; changed;) {
      changed = false
      for (const table of [...included]) {
        for (const edge of edgesOf(table)) {
          if (needed.has(edge.to) && !included.has(edge.to)) {
            included.add(edge.to)
            changed = true
          }
        }
      }
    }
    const result: { table: string, parentAlias: string, parentCol: string, thisCol: string }[] = []
    const emitted = new Set<string>([baseTable])
    const queue = [baseTable]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of edgesOf(current)) {
        if (included.has(edge.to) && !emitted.has(edge.to)) {
          result.push({ table: edge.to, parentAlias: current, parentCol: edge.fromCol, thisCol: edge.toCol })
          emitted.add(edge.to)
          queue.push(edge.to)
        }
      }
    }
    return result
  }

  /** Build SQL for a `ratio` metric: numerator / NULLIF(denominator, 0), grouped by the metric's dimensions. */
  private buildRatioSql(metricName: string, query: MetricQuery, dialect: SqlDialect, options: { currentRole?: string }): BuiltMetricSql {
    const { metric, datasource } = this.resolveMetric(metricName)
    const num = metric.numerator
    const den = metric.denominator
    if (num === undefined || den === undefined) {
      throw new GuardError(`Metric "${metric.name}" (ratio) requires both numerator and denominator.`)
    }
    const declared = metric.dimensions ?? []
    const requested = query.dimensions ?? declared
    for (const dimension of requested) {
      if (!declared.includes(dimension)) {
        throw new GuardError(`Dimension "${dimension}" is not declared on ratio metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
      }
    }
    if ((query.from !== undefined || query.to !== undefined) && metric.timeField === undefined) {
      throw new GuardError(`Ratio metric "${metric.name}" declares no timeField — from/to unsupported.`)
    }

    const sideSql = (ref: NonNullable<SemanticMetric['numerator']>): string => {
      // Resolve a metric reference into its entity/agg/measure/filters.
      let entityName = ref.entity
      let agg = ref.agg
      let measure = ref.measure
      let extraFilters = ref.filters ?? []
      if (ref.metric !== undefined) {
        const referenced = this.config.metrics?.find((entry) => entry.name === ref.metric)
        if (referenced === undefined) throw new GuardError(`Ratio side references unknown metric "${ref.metric}".`)
        entityName = entityName ?? referenced.entity
        agg = agg ?? referenced.agg
        measure = measure ?? referenced.measure
        extraFilters = [...(referenced.filters ?? []), ...extraFilters]
      }
      entityName = entityName ?? metric.entity
      const entity = this.config.entities?.find((entry) => entry.table === entityName)
      if (entity === undefined) throw new GuardError(`Ratio side references unknown entity "${entityName}".`)
      agg = agg ?? (measure !== undefined ? 'sum' : 'count')
      const measureColumn = measure !== undefined ? quoteIdentifier(assertSafeIdentifier(measure, 'ratio measure'), dialect) : undefined
      const aggExpr = (() => {
        if (agg === 'count') return 'COUNT(*)'
        if (measureColumn === undefined) throw new GuardError(`Ratio side agg "${agg}" requires a measure column.`)
        if (agg === 'count_distinct') return `COUNT(DISTINCT ${measureColumn})`
        if (agg === 'sum' || agg === 'avg' || agg === 'min' || agg === 'max') return `${agg.toUpperCase()}(${measureColumn})`
        // `expression`/`ratio` refs have no single-column form — refuse
        // rather than emit `EXPRESSION(...)` and let the DB reject it.
        throw new GuardError(`Ratio side agg "${agg}" is not supported — use count/count_distinct/sum/avg/min/max, or point the side at a plain metric.`)
      })()
      // Model-supplied filters/time bounds must actually reach both sides.
      // A predicate applies to this side only when the column exists here; a
      // filter key that exists on NEITHER side is a caller error (refuse).
      const sideColumns = new Set((entity.columns ?? []).map((columnMeta) => columnMeta.name))
      const predicates = [...(metric.filters ?? []), ...extraFilters]
      for (const [key, raw] of Object.entries(query.filters ?? {})) {
        if (!sideColumns.has(key)) continue
        const column = quoteIdentifier(assertSafeIdentifier(key, 'filter dimension'), dialect)
        if (Array.isArray(raw)) {
          if (raw.length === 0) continue
          const literals = (raw as readonly (string | number)[]).map((value) => sqlLiteral(value, dialect)).join(', ')
          predicates.push(`${column} IN (${literals})`)
        } else {
          predicates.push(`${column} = ${sqlLiteral(raw as string | number | boolean, dialect)}`)
        }
      }
      if (metric.timeField !== undefined && sideColumns.has(metric.timeField)) {
        const timeCol = quoteIdentifier(assertSafeIdentifier(metric.timeField, 'timeField'), dialect)
        if (query.from !== undefined) predicates.push(`${timeCol} >= ${sqlLiteral(query.from, dialect)}`)
        if (query.to !== undefined) {
          predicates.push(/^\d{4}-\d{2}-\d{2}$/.test(query.to)
            ? `${timeCol} < ${sqlLiteral(nextDay(query.to), dialect)}`
            : `${timeCol} <= ${sqlLiteral(query.to, dialect)}`)
        }
      }
      const dimSelect = requested.map((dimension) => `${quoteIdentifier(assertSafeIdentifier(dimension, 'dim'), dialect)} AS ${quoteIdentifier(dimension, dialect)}`).join(', ')
      const dimGroup = requested.map((dimension) => quoteIdentifier(assertSafeIdentifier(dimension, 'dim'), dialect)).join(', ')
      const selectList = requested.length > 0 ? `${dimSelect}, ${aggExpr} AS v` : `${aggExpr} AS v`
      const groupBy = requested.length > 0 ? `\nGROUP BY ${dimGroup}` : ''
      const whereClause = predicates.length > 0 ? `\nWHERE ${predicates.join('\n  AND ')}` : ''
      return `SELECT ${selectList}\nFROM ${quoteIdentifier(entityName, dialect)}${whereClause}${groupBy}`
    }

    // Refuse filter keys that exist on neither side entity — they would
    // otherwise be dropped and the ratio silently computed over everything.
    {
      const entityNames = new Set<string>()
      for (const ref of [num, den]) {
        const refEntity = ref.entity
          ?? (ref.metric !== undefined ? this.config.metrics?.find((entry) => entry.name === ref.metric)?.entity : undefined)
          ?? metric.entity
        entityNames.add(refEntity)
      }
      const knownColumns = new Set<string>()
      for (const name of entityNames) {
        const found = this.config.entities?.find((entry) => entry.table === name)
        for (const column of found?.columns ?? []) knownColumns.add(column.name)
      }
      for (const key of Object.keys(query.filters ?? {})) {
        if (!declared.includes(key)) {
          throw new GuardError(`Filter key "${key}" is not a declared dimension of ratio metric "${metric.name}" (allowed: ${declared.join('/') || 'none'}).`)
        }
        if (!knownColumns.has(key)) {
          throw new GuardError(`Filter key "${key}" does not exist on either ratio side of "${metric.name}".`)
        }
      }
    }

    const numSql = sideSql(num)
    const denSql = sideSql(den)
    const rawLimit = query.limit
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit! : 500, 1), 5000)
    let sql: string
    if (requested.length > 0) {
      const joinOn = requested.map((dimension) => `num.${quoteIdentifier(dimension, dialect)} = den.${quoteIdentifier(dimension, dialect)}`).join(' AND ')
      const dimSelect = requested.map((dimension) => `COALESCE(num.${quoteIdentifier(dimension, dialect)}, den.${quoteIdentifier(dimension, dialect)}) AS ${quoteIdentifier(dimension, dialect)}`).join(', ')
      sql = `SELECT ${dimSelect}, num.v / NULLIF(den.v, 0) AS value\nFROM (${numSql}) AS num\nLEFT JOIN (${denSql}) AS den ON ${joinOn}\nLIMIT ${limit}`
    } else {
      sql = `SELECT (${numSql}) / NULLIF((${denSql}), 0) AS value\nFROM (${numSql}) AS num, (${denSql}) AS den\nLIMIT ${limit}`
    }
    const columns = [
      ...requested.map((dimension) => ({ name: dimension, label: dimension })),
      { name: 'value', label: metric.label ?? metric.name },
    ]
    return { sql, datasource, dialect, columns }
  }
}
