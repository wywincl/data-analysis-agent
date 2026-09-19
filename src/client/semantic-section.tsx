/**
 * Semantic-layer section of the Database Workbench card.
 *
 * Combines three jobs the bare path box could not do:
 *  - T0/T1 preview: a live, read-only summary (status / counts / metric list /
 *    lint issues) pushed by the host via `semanticSummary`.
 *  - T3 editor: add/edit entities, metrics and terms through per-item cards
 *    (labeled field grids; rarely-used metric fields fold away); the draft is
 *    written to `semanticWorkbench` and the host persists it to a dedicated
 *    file (never overwriting the operator's hand-authored config).
 *  - T4 scaffold: "generate from datasource" introspects a connection and
 *    scaffolds a starter layer.
 *
 * @module dsh-data-analysis/client/semantic-section
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientKey } from '../i18n/client.ts'
import type { SemanticSummary, SemanticConfig, MetricAgg, LintIssueView, SemanticColumnValue } from '../semantic/types.ts'
import { METRIC_AGGS } from '../semantic/types.ts'
import type { WorkbenchSection } from './settings-card.tsx'
import {
  Field, inputFull, inputErrorClass, btnPrimary, btnGhost, btnDangerGhost,
  cardBox, fieldGrid, chipStyle,
} from './workbench-ui.tsx'
import { stringify } from 'yaml'

type EntityColumnRaw = NonNullable<import('../semantic/types.ts').SemanticEntity['columns']>[number]
type RelationshipRaw = NonNullable<import('../semantic/types.ts').SemanticEntity['relationships']>[number]
type MetricRefRaw = NonNullable<import('../semantic/types.ts').SemanticMetric['numerator']>

/**
 * Draft rows carry every authored field, not just the ones with a form
 * control: fields without UI (relationships, values, ratio sides, joins…) are
 * held opaquely and written back verbatim on save, so editing a metric never
 * silently strips structure the operator or the scaffold authored.
 */
interface EntityDraft { table: string; label: string; description: string; timeField: string; columnsText: string; entityKey: string; extendsName: string; relationships: RelationshipRaw[]; columnsRaw: EntityColumnRaw[] }
interface MetricDraft { name: string; label: string; entity: string; agg: string; measure: string; dimensions: string; filters: string; formula: string; grain: string; extends: string; timeField: string; joins: string[]; numerator?: MetricRefRaw; denominator?: MetricRefRaw; expression: string }
interface TermDraft { name: string; aliases: string; description: string }
interface LayerDraft { entities: EntityDraft[]; metrics: MetricDraft[]; terms: TermDraft[] }

const emptyDraft = (): LayerDraft => ({ entities: [], metrics: [], terms: [] })

function parseColumns(text: string): { name: string, label?: string }[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const idx = line.indexOf(':')
    if (idx === -1) return { name: line }
    const name = line.slice(0, idx).trim()
    const label = line.slice(idx + 1).trim()
    return label ? { name, label } : { name }
  })
}

function serializeColumns(cols?: { name: string, label?: string }[]): string {
  return (cols ?? []).map((c) => (c.label ? `${c.name}: ${c.label}` : c.name)).join('\n')
}

/**
 * Reattach the fields without form controls to the freshly parsed columns:
 * the textarea only edits `name: label`, and the rest (description, unit,
 * sensitive, values) survives a save untouched.
 */
function mergeColumnRaw(parsed: { name: string, label?: string }[], raw: EntityColumnRaw[]): EntityColumnRaw[] {
  const byName = new Map(raw.map((column) => [column.name, column]))
  return parsed.map((column) => {
    const extra = byName.get(column.name)
    return {
      name: column.name,
      ...(column.label !== undefined ? { label: column.label } : {}),
      ...(extra?.description !== undefined ? { description: extra.description } : {}),
      ...(extra?.unit !== undefined ? { unit: extra.unit } : {}),
      ...(extra?.sensitive !== undefined ? { sensitive: extra.sensitive } : {}),
      ...(extra?.values !== undefined ? { values: extra.values } : {}),
    }
  })
}

function toConfig(d: LayerDraft): SemanticConfig {
  return {
    entities: d.entities.filter((e) => e.table.trim() !== '').map((e) => ({
      table: e.table.trim(),
      ...(e.extendsName.trim() !== '' ? { extends: e.extendsName.trim() } : {}),
      ...(e.entityKey.trim() !== '' ? { key: e.entityKey.trim() } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.timeField ? { timeField: e.timeField } : {}),
      ...(parseColumns(e.columnsText).length > 0 ? { columns: mergeColumnRaw(parseColumns(e.columnsText), e.columnsRaw) } : {}),
      ...(e.relationships.length > 0 ? { relationships: e.relationships } : {}),
    })),
    metrics: d.metrics.filter((m) => m.name.trim() !== '').map((m) => ({
      name: m.name.trim(),
      ...(m.label ? { label: m.label } : {}),
      entity: m.entity,
      agg: m.agg as MetricAgg,
      ...(m.measure ? { measure: m.measure } : {}),
      ...(m.dimensions.trim() ? { dimensions: m.dimensions.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(m.filters.trim() ? { filters: m.filters.split('\n').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(m.formula ? { formula: m.formula } : {}),
      ...(m.grain ? { grain: m.grain } : {}),
      ...(m.extends ? { extends: m.extends } : {}),
      ...(m.timeField ? { timeField: m.timeField } : {}),
      ...(m.joins.length > 0 ? { joins: m.joins } : {}),
      ...(m.numerator !== undefined ? { numerator: m.numerator } : {}),
      ...(m.denominator !== undefined ? { denominator: m.denominator } : {}),
      ...(m.expression.trim() !== '' ? { expression: m.expression } : {}),
    })),
    terms: d.terms.filter((t2) => t2.name.trim() !== '').map((t2) => ({
      name: t2.name.trim(),
      ...(t2.aliases.trim() ? { aliases: t2.aliases.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      description: t2.description,
    })),
  }
}

function fromConfig(c?: SemanticConfig): LayerDraft {  return {
    entities: (c?.entities ?? []).map((e) => ({
      table: e.table, label: e.label ?? '', description: e.description ?? '',
      timeField: e.timeField ?? '', columnsText: serializeColumns(e.columns),
      entityKey: e.key ?? '', extendsName: e.extends ?? '',
      relationships: e.relationships ?? [], columnsRaw: e.columns ?? [],
    })),
    metrics: (c?.metrics ?? []).map((m) => ({
      name: m.name, label: m.label ?? '', entity: m.entity, agg: m.agg,
      measure: m.measure ?? '', dimensions: (m.dimensions ?? []).join(', '),
      filters: (m.filters ?? []).join('\n'), formula: m.formula ?? '',
      grain: m.grain ?? '', extends: m.extends ?? '', timeField: m.timeField ?? '',
      joins: m.joins ?? [], ...(m.numerator !== undefined ? { numerator: m.numerator } : {}),
      ...(m.denominator !== undefined ? { denominator: m.denominator } : {}),
      expression: m.expression ?? '',
    })),
    terms: (c?.terms ?? []).map((t2) => ({
      name: t2.name, aliases: (t2.aliases ?? []).join(', '), description: t2.description,
    })),
  }
}

/** A metric row uses its advanced fields (folded away by default otherwise). */
const usesAdvancedFields = (m: MetricDraft): boolean =>
  m.grain.trim() !== '' || m.extends.trim() !== '' || m.filters.trim() !== '' || m.formula.trim() !== ''

/**
 * Cheap client-side checks before hitting the layer. Catches the mistakes a
 * form editor makes most often (missing required fields, empty rows, broken
 * comma-separated dimension lists) so the operator fixes them before save
 * triggers a parse/validation error on the host side.
 */
function validateDraft(draft: LayerDraft, t: (key: ClientKey, params?: Record<string, unknown>) => string): string[] {
  const issues: string[] = []
  draft.entities.forEach((e, i) => {
    if (e.table.trim() === '') issues.push(`${t('settings.semanticEntities')} #${i + 1}: ${t('settings.semanticValidationMissingTable')}`)
    if (e.timeField.trim() !== '' && e.columnsText !== '' && !parseColumns(e.columnsText).some((c) => c.name === e.timeField.trim())) {
      issues.push(`${t('settings.semanticEntities')} #${i + 1}: ${t('settings.semanticValidationUnknownTimeField')}`)
    }
  })
  const entityTables = new Set(draft.entities.map((e) => e.table.trim()).filter(Boolean))
  draft.metrics.forEach((m, i) => {
    if (m.name.trim() === '') issues.push(`${t('settings.semanticMetrics')} #${i + 1}: ${t('settings.semanticValidationMissingName')}`)
    if (m.entity.trim() === '') issues.push(`${t('settings.semanticMetrics')} #${i + 1}: ${t('settings.semanticValidationMissingEntity')}`)
    else if (!entityTables.has(m.entity)) issues.push(`${t('settings.semanticMetrics')} #${i + 1}: ${t('settings.semanticValidationUnknownEntity')}`)
    if (m.agg !== 'count' && m.measure.trim() === '' && m.formula.trim() === '' && m.extends.trim() === '') {
      issues.push(`${t('settings.semanticMetrics')} #${i + 1}: ${t('settings.semanticValidationMissingMeasure')}`)
    }
  })
  draft.terms.forEach((tm, i) => {
    if (tm.name.trim() === '') issues.push(`${t('settings.semanticTerms')} #${i + 1}: ${t('settings.semanticValidationMissingName')}`)
  })
  return issues
}

export function SemanticSection({ scope, t, semanticFile, setSemanticFile, datasourceNames }: {
  scope: SettingsScope<WorkbenchSection>
  t: (key: ClientKey, params?: Record<string, unknown>) => string
  semanticFile: string
  setSemanticFile: (value: string) => void
  datasourceNames: string[]
}): ReactNode {
  const [rev, setRev] = useState(0)
  useEffect(() => scope.subscribe(() => { setRev((n) => n + 1) }), [scope])

  const snapshot = scope.getSnapshot().value
  const summary = snapshot?.semanticSummary
  const workbench = snapshot?.semanticWorkbench

  const [draft, setDraft] = useState<LayerDraft>(emptyDraft())
  const [lastStagedJson, setLastStagedJson] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const [scaffoldDs, setScaffoldDs] = useState('')
  const [scaffolding, setScaffolding] = useState(false)
  // Mirror for timeouts/effects that must read liveness without nesting a
  // setState inside another setState's updater (double-invoked in StrictMode).
  const scaffoldingRef = useRef(false)
  const [scaffoldError, setScaffoldError] = useState<string | null>(null)
  const [validationIssues, setValidationIssues] = useState<string[]>([])
  const [showSource, setShowSource] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'editor'>('preview')
  // Per-metric-card fold state: undefined follows "auto" (open only when the
  // row actually uses an advanced field).
  const [advOpen, setAdvOpen] = useState<Record<number, boolean>>({})

  // Stage the editor from the host-echoed workbench content. Re-stages only
  // when the echoed JSON actually changed (a save or scaffold), so unsaved
  // typing is never clobbered. Editing is entered lazily via the tab button.
  // Memoized on the snapshot identity: without it every keystroke render
  // re-serializes the whole workbench config.
  const wbJson = useMemo(() => JSON.stringify(workbench ?? null), [workbench])
  useEffect(() => {
    if (wbJson === lastStagedJson) return
    if (workbench !== undefined && workbench !== null) {
      setDraft(fromConfig(workbench))
    } else {
      setDraft(emptyDraft())
    }
    setLastStagedJson(wbJson)
    setDraftDirty(false)
    // A fresh scaffold echo means the layer changed: pull its definitions in.
    if (scaffolding && (workbench?.entities?.length ?? 0) > 0) {
      scaffoldingRef.current = false
      setScaffolding(false)
      setScaffoldError(null)
      setSaved(true)
      setEditing(true)
      setActiveTab('editor')
    }
  }, [wbJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: keyof LayerDraft, index: number, field: string, value: string): void => {
    setSaved(false)
    setDraftDirty(true)
    setDraft((current) => {
      const list = (current[key] as unknown as Array<Record<string, unknown>>).map((item) => ({ ...item }))
      list[index] = { ...list[index], [field]: value }
      return { ...current, [key]: list } as LayerDraft
    })
  }
  const addRow = (key: keyof LayerDraft, row: EntityDraft | MetricDraft | TermDraft): void => {
    setSaved(false)
    setDraftDirty(true)
    setDraft((current) => {
      const list = [...(current[key] as unknown[]), row]
      return { ...current, [key]: list } as LayerDraft
    })
  }
  const removeRow = (key: keyof LayerDraft, index: number): void => {
    setSaved(false)
    setDraftDirty(true)
    setDraft((current) => {
      const list = (current[key] as unknown[]).filter((_, i) => i !== index)
      return { ...current, [key]: list } as LayerDraft
    })
  }

  const saveLayer = (): void => {
    const issues = validateDraft(draft, t)
    setValidationIssues(issues)
    if (issues.length > 0) return
    setSaved(false)
    void scope.set('semanticWorkbench', toConfig(draft))
    setSaved(true)
    setDraftDirty(false)
  }

  const resetDraft = (): void => {
    setDraft(workbench !== undefined && workbench !== null ? fromConfig(workbench) : emptyDraft())
    setValidationIssues([])
    setSaved(false)
    setDraftDirty(false)
  }

  const runScaffold = (): void => {
    if (scaffoldDs.trim() === '') return
    scaffoldingRef.current = true
    setScaffolding(true)
    setScaffoldError(null)
    const nonce = Date.now()
    void scope.set('scaffoldRequest', { datasource: scaffoldDs, nonce })
    // Guard against a silent failure: if no workbench echo arrives, surface an
    // error instead of leaving the UI in a perpetual "generating" state.
    window.setTimeout(() => {
      if (!scaffoldingRef.current) return
      scaffoldingRef.current = false
      setScaffolding(false)
      setScaffoldError(t('settings.semanticScaffoldTimeout'))
    }, 8000)
  }

  const statusColor = (s?: SemanticSummary['state']): string => {
    if (s === 'ok') return 'var(--rd-success)'
    if (s === 'parse-error' || s === 'missing') return 'var(--rd-error)'
    return 'var(--rd-muted)'
  }
  const statusLabel = (s?: SemanticSummary['state']): string => {
    if (s === 'ok') return t('settings.semanticLoaded')
    if (s === 'parse-error') return t('settings.semanticParseError')
    if (s === 'missing') return t('settings.semanticFileMissing')
    return t('settings.semanticEmpty')
  }

  const hasLayer = (summary?.counts.entities ?? 0) + (summary?.counts.metrics ?? 0) + (summary?.counts.terms ?? 0) > 0
  const openEditor = (): void => { setEditing(true); setActiveTab('editor') }
  const aggLabel = (agg: string): string => t(`settings.semanticAgg.${agg}` as ClientKey)

  /**
   * Correlate a preview metric card with a lint finding. `unbounded-metric`
   * issues carry a path shaped `metrics["<name>"]` (see lint.ts), so a card
   * can surface its own inline warning and one-click fix.
   */
  const metricIssue = (name: string): LintIssueView | undefined =>
    summary?.issues.find((i) => i.code === 'unbounded-metric' && i.path.includes(`["${name}"]`))

  /** Number of metrics that inherit a time column from their entity (fixable). */
  const fixableIssues = summary?.issues.filter((i) => i.code === 'unbounded-metric' && i.path.startsWith('metrics[')).length ?? 0

  /** True when some draft metric is missing its time column but its entity has one. */
  const needsTimeFieldFix = draft.metrics.some((m) => m.timeField.trim() === '' && draft.entities.some((e) => e.table.trim() === m.entity.trim() && e.timeField.trim() !== ''))

  /** One-click rookie fix: inherit the entity time column into bare metrics. */
  const fixMissingTimeFields = (): void => {
    const tfByEntity = new Map(draft.entities.filter((e) => e.timeField.trim() !== '').map((e) => [e.table.trim(), e.timeField.trim()]))
    setDraft({
      ...draft,
      metrics: draft.metrics.map((m) => (m.timeField.trim() !== '' ? m : { ...m, timeField: tfByEntity.get(m.entity.trim()) ?? '' })),
    })
    setSaved(false)
    setDraftDirty(true)
    setValidationIssues([])
    openEditor()
  }

  const previewCount = (summary?.counts.entities ?? 0) + (summary?.counts.metrics ?? 0) + (summary?.counts.terms ?? 0)

  return (
    <div style={cardBox}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={sectionTitle}>{t('settings.semantic')}</div>
        {draftDirty && <span style={chipStyle('var(--rd-accent)')}>● {t('settings.unsaved')}</span>}
      </div>
      <div style={muted}>{t('settings.semanticHint')}</div>

      {/* path input */}
      <div style={{ ...toolbar, marginTop: 2 }}>
        <Field label={t('settings.semanticPath')} span>
          <input
            style={inputFull}
            value={semanticFile}
            placeholder={t('settings.semanticPathPlaceholder')}
            onChange={(event) => setSemanticFile(event.target.value)}
          />
        </Field>
      </div>

      {/* friendly status banner */}
      {summary && (
        <div style={banner(hasLayer ? (summary.issues.length === 0 ? 'var(--rd-success)' : 'var(--rd-error)') : statusColor(summary.state))}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {!hasLayer && summary.state !== 'empty' && <span style={statusChip(statusColor(summary.state))}>● {statusLabel(summary.state)}</span>}
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {hasLayer
                ? (summary.issues.length === 0 ? t('settings.semanticReady') : t('settings.semanticNeedsFix', { n: summary.issues.length }))
                : t('settings.semanticNotStarted')}
            </span>
            {hasLayer && <span style={mutedFine}>{t('settings.semanticReadySummary', { e: summary.counts.entities, m: summary.counts.metrics, t: summary.counts.terms })}</span>}
          </div>
          <div style={mutedFine}>
            {hasLayer
              ? (summary.issues.length === 0 ? t('settings.semanticReadyHint') : t('settings.semanticNeedsFixHint', { n: summary.issues.length }))
              : t('settings.semanticNotStartedHint')}
          </div>
          {summary.file !== undefined && summary.files.length > 0 && (
            <div style={mutedFine}>{t('settings.semanticFileLabel')} {summary.file}{summary.files.length > 1 ? ` ${t('settings.semanticPlusFiles')}` : ''}</div>
          )}
          {summary.error !== undefined && <div style={errorBox}>{summary.error}</div>}
        </div>
      )}

      {/* Tabs: Preview / Editor (with counts and a dirty marker) */}
      <div style={tabsContainer}>
        <button type="button" style={activeTab === 'preview' ? tabActive : tab} onClick={() => { setActiveTab('preview'); setEditing(false) }}>
          {t('settings.semanticPreview')}{hasLayer ? ` · ${previewCount}` : ''}
        </button>
        <button type="button" style={{ ...(activeTab === 'editor' ? tabActive : tab), display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { setEditing(true); setActiveTab('editor') }}>
          {t('settings.semanticEdit')}
          {draftDirty && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--rd-accent)', flex: 'none' }} />}
        </button>
      </div>

      {/* begin here: guided empty state (nothing configured yet) */}
      {summary && activeTab === 'preview' && !hasLayer && (
        <div style={hero}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.semanticEmptyHero')}</div>
          <div style={muted}>{t('settings.semanticEmptySub')}</div>
          {[1, 2, 3].map((n) => (
            <div key={n} style={stepRow}>
              <span style={stepNum}>{n}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{t(`settings.semanticStep${n}Title` as ClientKey)}</div>
                <div style={mutedFine}>{t(`settings.semanticStep${n}Text` as ClientKey)}</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {datasourceNames.length > 0 ? (
              <>
                <select style={{ ...inputFull, width: 200 }} value={scaffoldDs} onChange={(event) => setScaffoldDs(event.target.value)}>
                  <option value="">{t('settings.defaultSourceAuto')}</option>
                  {datasourceNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button type="button" style={btnPrimary} disabled={scaffoldDs.trim() === '' || scaffolding} onClick={() => { setActiveTab('editor'); runScaffold() }}>
                  {scaffolding ? t('settings.semanticGenerating') : t('settings.semanticGoGenerate')}
                </button>
              </>
            ) : (
              <button type="button" style={btnPrimary} onClick={openEditor}>{t('settings.semanticGoGenerate')}</button>
            )}
          </div>
        </div>
      )}

      {/* interactive preview: click any card to jump into editing */}
      {summary && activeTab === 'preview' && hasLayer && (
        <div style={preview}>
          {/* metrics as clickable cards */}
          <div style={subTitle}>{t('settings.semanticMetrics')}</div>
          {summary.metrics.length === 0 && <div style={mutedFine}>{t('settings.semanticNoMetrics')}</div>}
          {summary.metrics.map((m) => {
            const issue = metricIssue(m.name)
            return (
              <div key={m.name} className="rdwb-clickable" style={metricCard} onClick={openEditor} role="button" tabIndex={0}>
                <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{m.label ?? m.name}</span>
                  {m.label !== undefined && <span style={mutedFine}>{m.name}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <span style={chip()}>{t('settings.semanticMetricEntity')}: {m.entity}</span>
                  <span style={chip()}>{aggLabel(m.agg)}{m.measure ? `(${m.measure})` : ''}</span>
                  {issue !== undefined && <span style={chip('var(--rd-error)')}>{t('settings.semanticUnboundedChip')}</span>}
                  <span style={mutedFine}>{t('settings.semanticClickEdit')} →</span>
                </div>
                {issue !== undefined && (
                  <div style={warnBox}>
                    <div style={{ fontSize: 12 }}>{issue.message}{issue.hint !== undefined ? ` — ${issue.hint}` : ''}</div>
                    <button type="button" style={fixBtn} onClick={(event) => { event.stopPropagation(); fixMissingTimeFields() }}>{t('settings.semanticFixNow')}</button>
                  </div>
                )}
                {m.formula !== undefined && <div style={mutedFine}>{m.formula}</div>}
              </div>
            )
          })}

          {/* entities */}
          <div style={subTitle}>{t('settings.semanticEntities')}</div>
          {summary.entities.length === 0 && <div style={mutedFine}>{t('settings.semanticNoEntities')}</div>}
          {summary.entities.map((e) => (
            <div key={e.table} className="rdwb-clickable" style={entityRow} onClick={openEditor} role="button" tabIndex={0}>
              <span style={{ fontWeight: 600 }}>{e.table}</span>
              {e.label !== undefined && <span style={mutedFine}> · {e.label}</span>}
              {e.key !== undefined && <span style={chip('var(--rd-success)')}>PK {e.key}</span>}
              {(e.relationships ?? []).map((rel) => (
                <span key={`${rel.entity}.${rel.on.join('=')}`} style={chip('var(--rd-accent)')}>
                  {rel.name !== undefined ? `${rel.name} → ${rel.entity}` : `→ ${rel.entity}`}
                </span>
              ))}
              <span style={chip('var(--rd-accent)')}>{t('settings.semanticClickEdit')} →</span>
            </div>
          ))}

          {/* terms */}
          <div style={subTitle}>{t('settings.semanticTerms')}</div>
          {summary.terms.length === 0 && <div style={mutedFine}>{t('settings.semanticNoTerms')}</div>}
          {summary.terms.map((t2) => (
            <div key={t2.name} className="rdwb-clickable" style={entityRow} onClick={openEditor} role="button" tabIndex={0}>
              <span style={{ fontWeight: 600 }}>{t2.name}</span>
              {t2.description !== '' && <span style={mutedFine}> · {t2.description}</span>}
            </div>
          ))}

          {/* health issues */}
          <div style={{ marginTop: 4 }}>
            <div style={subTitle}>{t('settings.semanticIssues')}</div>
            {summary.issues.length === 0
              ? <div style={mutedFine}>{t('settings.semanticNoIssues')}</div>
              : <div style={list}>
                {summary.issues.map((issue, i) => (
                  <div key={i} style={issueRow}>
                    <span style={statusChip('var(--rd-error)')}>!</span>
                    <div>
                      <div style={{ fontSize: 12 }}>{issue.message}</div>
                      {issue.hint !== undefined && <div style={mutedFine}>{issue.hint}</div>}
                      <div style={mutedFine}>{issue.path}</div>
                    </div>
                  </div>
                ))}
                {fixableIssues > 0 && needsTimeFieldFix && (
                  <button type="button" style={fixAllBtn} onClick={fixMissingTimeFields}>
                    {t('settings.semanticFixAll', { n: fixableIssues })}
                  </button>
                )}
              </div>}
          </div>
        </div>
      )}

      {/* T4 scaffold + editor live under the editor tab */}
      {activeTab === 'editor' && (
        <div style={scaffoldBox}>
          <div style={scaffoldLabel}>{t('settings.semanticScaffold') ?? '从数据源生成起步语义层'}</div>
          <div style={{ ...toolbar, alignItems: 'center' }}>
            <select style={{ ...inputFull, width: 200 }} value={scaffoldDs} onChange={(event) => setScaffoldDs(event.target.value)}>
              <option value="">{t('settings.defaultSourceAuto')}</option>
              {datasourceNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" style={btnGhost} disabled={scaffoldDs.trim() === '' || scaffolding} onClick={runScaffold}>{scaffolding ? '生成中…' : t('settings.semanticScaffoldRun')}</button>
            {scaffoldError !== null && <span style={scaffoldErrorStyle}>{scaffoldError}</span>}
          </div>
          <div style={mutedFine}>{t('settings.semanticScaffoldHint')}</div>
        </div>
      )}

      {/* Editor: one card per item */}
      {activeTab === 'editor' && editing && (
        <div style={editor}>
          {saved && <div style={markBanner('var(--rd-success)')}>{t('settings.semanticDraftSaved')}</div>}

          {/* source toggle */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" style={showSource ? { ...btnGhost, color: 'var(--rd-accent)', borderColor: 'var(--rd-accent)' } : btnGhost} onClick={() => setShowSource((v) => !v)}>{t('settings.semanticSource')}</button>
            {needsTimeFieldFix && <button type="button" style={fixAllBtn} onClick={fixMissingTimeFields}>{t('settings.semanticAutoFillTime')}</button>}
            {showSource && <span style={mutedFine}>{t('settings.semanticSourceHint')}</span>}
          </div>
          {showSource && (
            <pre style={sourcePre}>{stringify(toConfig(draft))}</pre>
          )}

          {/* entities */}
          <div style={subTitle}>{t('settings.semanticEntities')}</div>
          <div style={mutedFine}>{t('settings.semanticEntityHint')}</div>
          {draft.entities.length === 0 && <div style={mutedFine}>{t('settings.semanticNoEntities')}</div>}
          {draft.entities.map((e, i) => (
            <div key={i} style={editCard}>
              <div style={editCardHeader}>
                <span style={editIndex}>{i + 1}</span>
                <input className="rdwb-name-input" style={nameInputStyle} placeholder={t('settings.semanticEntityTable')} value={e.table} onChange={(ev) => patch('entities', i, 'table', ev.target.value)} />
                <button type="button" style={btnDangerGhost} onClick={() => removeRow('entities', i)}>{t('settings.semanticDelete')}</button>
              </div>
              <div style={fieldGrid}>
                <Field label={t('settings.semanticEntityLabel')}>
                  <input style={inputFull} value={e.label} onChange={(ev) => patch('entities', i, 'label', ev.target.value)} />
                </Field>
                <Field label={t('settings.semanticEntityTimeField')}>
                  <input style={inputFull} placeholder="created_at" value={e.timeField} onChange={(ev) => patch('entities', i, 'timeField', ev.target.value)} />
                </Field>
                <Field label={t('settings.semanticEntityColumns')} span>
                  <textarea style={textArea} placeholder={t('settings.semanticEntityColumns')} value={e.columnsText} onChange={(ev) => patch('entities', i, 'columnsText', ev.target.value)} />
                </Field>
                <Field label={t('settings.semanticEntityDesc')} span>
                  <input style={inputFull} value={e.description} onChange={(ev) => patch('entities', i, 'description', ev.target.value)} />
                </Field>
              </div>
            </div>
          ))}
          <button type="button" style={addButton} onClick={() => { addRow('entities', { table: '', label: '', description: '', timeField: '', columnsText: '', entityKey: '', extendsName: '', relationships: [], columnsRaw: [] }); setAdvOpen({}) }}>{t('settings.semanticAddEntity')}</button>

          {/* metrics */}
          <div style={subTitle}>{t('settings.semanticMetrics')}</div>
          <div style={mutedFine}>{t('settings.semanticMetricHint')}</div>
          {draft.metrics.length === 0 && <div style={mutedFine}>{t('settings.semanticNoMetrics')}</div>}
          {draft.metrics.map((m, i) => {
            const advOpenFor = advOpen[i] ?? usesAdvancedFields(m)
            const invalidEntity = m.entity.trim() !== '' && !draft.entities.some((e) => e.table.trim() === m.entity.trim())
            return (
              <div key={i} style={editCard}>
                <div style={editCardHeader}>
                  <span style={editIndex}>{i + 1}</span>
                  <input className="rdwb-name-input" style={nameInputStyle} placeholder={t('settings.semanticMetricName')} value={m.name} onChange={(ev) => patch('metrics', i, 'name', ev.target.value)} />
                  <button type="button" style={btnDangerGhost} onClick={() => removeRow('metrics', i)}>{t('settings.semanticDelete')}</button>
                </div>
                <div style={fieldGrid}>
                  <Field label={t('settings.semanticMetricLabel')}>
                    <input style={inputFull} value={m.label} onChange={(ev) => patch('metrics', i, 'label', ev.target.value)} />
                  </Field>
                  <Field label={t('settings.semanticMetricEntity')}>
                    <select style={inputFull} className={invalidEntity ? inputErrorClass : undefined} value={m.entity} onChange={(ev) => patch('metrics', i, 'entity', ev.target.value)}>
                      <option value="">—</option>
                      {draft.entities.map((e) => <option key={e.table} value={e.table}>{e.table}</option>)}
                    </select>
                  </Field>
                  <Field label={t('settings.semanticMetricAgg')}>
                    <select style={inputFull} value={m.agg} onChange={(ev) => patch('metrics', i, 'agg', ev.target.value)}>
                      {METRIC_AGGS.map((a) => <option key={a} value={a}>{aggLabel(a)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('settings.semanticMetricMeasure')}>
                    <input style={inputFull} placeholder="amount" value={m.measure} onChange={(ev) => patch('metrics', i, 'measure', ev.target.value)} />
                  </Field>
                  <Field label={t('settings.semanticMetricTimeField')}>
                    <input style={inputFull} value={m.timeField} onChange={(ev) => patch('metrics', i, 'timeField', ev.target.value)} />
                  </Field>
                  <Field label={t('settings.semanticMetricDimensions')}>
                    <input style={inputFull} placeholder="status, region" value={m.dimensions} onChange={(ev) => patch('metrics', i, 'dimensions', ev.target.value)} />
                  </Field>
                </div>
                <button
                  type="button"
                  style={{ ...foldBtn, color: advOpenFor ? 'var(--rd-accent)' : 'var(--rd-muted)' }}
                  onClick={() => setAdvOpen((current) => ({ ...current, [i]: !advOpenFor }))}
                >
                  {advOpenFor ? `▾ ${t('settings.lessFields')}` : `▸ ${t('settings.moreFields')}`}
                </button>
                {advOpenFor && (
                  <div style={fieldGrid}>
                    <Field label={t('settings.semanticMetricGrain')}>
                      <input style={inputFull} value={m.grain} onChange={(ev) => patch('metrics', i, 'grain', ev.target.value)} />
                    </Field>
                    <Field label={t('settings.semanticMetricExtends')}>
                      <input style={inputFull} value={m.extends} onChange={(ev) => patch('metrics', i, 'extends', ev.target.value)} />
                    </Field>
                    <Field label={t('settings.semanticMetricFilters')} span>
                      <textarea style={textArea} placeholder={t('settings.semanticMetricFilters')} value={m.filters} onChange={(ev) => patch('metrics', i, 'filters', ev.target.value)} />
                    </Field>
                    <Field label={t('settings.semanticMetricFormula')} span>
                      <input style={inputFull} value={m.formula} onChange={(ev) => patch('metrics', i, 'formula', ev.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" style={addButton} onClick={() => addRow('metrics', { name: '', label: '', entity: '', agg: 'sum', measure: '', dimensions: '', filters: '', formula: '', grain: '', extends: '', timeField: '', joins: [], expression: '' })}>{t('settings.semanticAddMetric')}</button>

          {/* terms */}
          <div style={subTitle}>{t('settings.semanticTerms')}</div>
          <div style={mutedFine}>{t('settings.semanticTermHint')}</div>
          {draft.terms.length === 0 && <div style={mutedFine}>{t('settings.semanticNoTerms')}</div>}
          {draft.terms.map((tm, i) => (
            <div key={i} style={editCard}>
              <div style={editCardHeader}>
                <span style={editIndex}>{i + 1}</span>
                <input className="rdwb-name-input" style={nameInputStyle} placeholder={t('settings.semanticTermName')} value={tm.name} onChange={(ev) => patch('terms', i, 'name', ev.target.value)} />
                <button type="button" style={btnDangerGhost} onClick={() => removeRow('terms', i)}>{t('settings.semanticDelete')}</button>
              </div>
              <div style={fieldGrid}>
                <Field label={t('settings.semanticTermAliases')}>
                  <input style={inputFull} placeholder="AU, 活跃" value={tm.aliases} onChange={(ev) => patch('terms', i, 'aliases', ev.target.value)} />
                </Field>
                <Field label={t('settings.semanticTermDesc')} span>
                  <input style={inputFull} value={tm.description} onChange={(ev) => patch('terms', i, 'description', ev.target.value)} />
                </Field>
              </div>
            </div>
          ))}
          <button type="button" style={addButton} onClick={() => addRow('terms', { name: '', aliases: '', description: '' })}>{t('settings.semanticAddTerm')}</button>

          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary} onClick={saveLayer}>{t('settings.semanticSaveLayer')}</button>
            <button type="button" style={btnGhost} disabled={!draftDirty} onClick={resetDraft}>{t('settings.semanticResetDraft')}</button>
            {draftDirty && <span style={mutedFine}>{t('settings.unsaved')}</span>}
          </div>
          {validationIssues.length > 0 && (
            <div style={errorBox}>
              {validationIssues.map((issue, i) => <div key={i} style={{ fontSize: 12 }}>{issue}</div>)}
            </div>
          )}
          <div style={mutedFine}>{t('settings.semanticLintHint')}</div>
        </div>
      )}
    </div>
  )
}

// --- styles (reuse the card's token vocabulary) ---
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }
const muted: React.CSSProperties = { color: 'var(--rd-muted)', lineHeight: 1.5, fontSize: 12 }
const mutedFine: React.CSSProperties = { ...muted, fontSize: 11 }
const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }
const preview: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, borderTop: '1px dashed var(--rd-border)', paddingTop: 8 }
const statusChip = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
  color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`,
  borderRadius: 999, padding: '1px 8px',
})
const errorBox: React.CSSProperties = { fontSize: 11, color: 'var(--rd-error)', background: 'color-mix(in srgb, var(--rd-error) 8%, transparent)', borderRadius: 6, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }
const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const issueRow: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 12, borderLeft: '2px solid var(--rd-error)', paddingLeft: 8 }
// Friendly preview cards / banners / guided steps
const hero: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--rd-border)', borderRadius: 10,
  padding: '10px 12px', background: 'color-mix(in srgb, var(--rd-accent) 4%, transparent)',
}
const banner = (color: string): React.CSSProperties => ({
  ...hero, background: `color-mix(in srgb, ${color} 6%, transparent)`, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
})
const metricCard: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid var(--rd-border)', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }
const entityRow: React.CSSProperties = { ...metricCard, padding: '6px 10px', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }
const chip = (color = 'var(--rd-muted)'): React.CSSProperties => ({
  fontSize: 11, color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, borderRadius: 999,
  padding: '0 8px', lineHeight: '18px', whiteSpace: 'nowrap',
})
const warnBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
  fontSize: 11, color: 'var(--rd-error)', background: 'color-mix(in srgb, var(--rd-error) 8%, transparent)',
  borderRadius: 8, padding: '5px 8px',
}
const fixBtn: React.CSSProperties = {
  border: '1px solid var(--rd-error)', borderRadius: 999, color: 'var(--rd-error)',
  background: 'transparent', cursor: 'pointer', fontSize: 11, padding: '2px 10px', whiteSpace: 'nowrap',
}
const fixAllBtn: React.CSSProperties = { ...fixBtn, borderColor: 'var(--rd-accent)', color: 'var(--rd-accent)', alignSelf: 'flex-start', marginTop: 2 }
const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8 }
const stepNum: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, marginTop: 1,
  borderRadius: 999, border: '1px solid var(--rd-accent)', color: 'var(--rd-accent)', fontSize: 11, fontWeight: 600,
}
const editor: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, borderTop: '1px dashed var(--rd-border)', paddingTop: 8 }
const subTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginTop: 4 }
// Per-item editor card: header (index + name + delete) then a labeled grid.
const editCard: React.CSSProperties = {
  border: '1px solid var(--rd-border)', borderRadius: 10, padding: '8px 10px',
  display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--rd-surface)',
}
const editCardHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const editIndex: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18,
  borderRadius: 999, background: 'var(--rd-accent-soft)', color: 'var(--rd-accent)', fontSize: 10.5, fontWeight: 600, flex: 'none',
}
const nameInputStyle: React.CSSProperties = {
  border: '1px solid transparent', borderRadius: 7, padding: '3px 8px', fontSize: 13, fontWeight: 600,
  flex: 1, minWidth: 100, background: 'transparent', color: 'inherit',
}
const foldBtn: React.CSSProperties = {
  alignSelf: 'flex-start', border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 11.5, padding: '0 2px', fontWeight: 600,
}
const textArea: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 7, padding: '5px 10px', fontSize: 12,
  background: 'transparent', color: 'inherit', width: '100%', minHeight: 52, resize: 'vertical',
  fontFamily: 'var(--rd-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', boxSizing: 'border-box',
}
const addButton: React.CSSProperties = { alignSelf: 'flex-start', border: '1px dashed var(--rd-control-border)', borderRadius: 999, background: 'transparent', color: 'var(--rd-accent)', cursor: 'pointer', fontSize: 12, padding: '4px 14px' }
const markBanner = (color: string): React.CSSProperties => ({
  fontSize: 12, color, padding: '6px 10px', borderRadius: 8, background: `color-mix(in srgb, ${color} 8%, transparent)`,
})
const sourcePre: React.CSSProperties = {
  margin: 0, padding: 8, borderRadius: 6, border: '1px solid var(--rd-border)',
  background: 'color-mix(in srgb, var(--rd-bg) 6%, transparent)', color: 'inherit',
  fontSize: 11, lineHeight: 1.5, fontFamily: 'var(--rd-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  overflowX: 'auto', maxHeight: 260, whiteSpace: 'pre', wordBreak: 'keep-all',
}
// Tabs
const tabsContainer: React.CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid var(--rd-border)', marginTop: 8 }
const tab: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--rd-muted)', cursor: 'pointer',
  fontSize: 12, padding: '6px 12px', borderBottom: '2px solid transparent',
}
const tabActive: React.CSSProperties = { ...tab, color: 'var(--rd-accent)', borderBottomColor: 'var(--rd-accent)', fontWeight: 600 }
// Scaffold box
const scaffoldBox: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--rd-accent) 5%, transparent)',
  border: '1px solid var(--rd-border)', borderRadius: 8, padding: 8, marginTop: 8,
}
const scaffoldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 6 }
const scaffoldErrorStyle: React.CSSProperties = { ...muted, color: 'var(--rd-error)' }
