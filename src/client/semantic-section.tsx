/**
 * Semantic-layer section of the Database Workbench card.
 *
 * Combines three jobs the bare path box could not do:
 *  - T0/T1 preview: a live, read-only summary (status / counts / metric list /
 *    lint issues) pushed by the host via `semanticSummary`.
 *  - T3 editor: add/edit entities, metrics and terms through forms; the draft
 *    is written to `semanticWorkbench` and the host persists it to a dedicated
 *    file (never overwriting the operator's hand-authored config).
 *  - T4 scaffold: "generate from datasource" introspects a connection and
 *    scaffolds a starter layer.
 *
 * @module dsh-rd-data-analysis/client/semantic-section
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientKey } from '../i18n/client.ts'
import type { SemanticSummary, SemanticConfig, MetricAgg } from '../semantic/types.ts'
import { METRIC_AGGS } from '../semantic/types.ts'
import type { WorkbenchSection } from './settings-card.tsx'

interface EntityDraft { table: string; label: string; description: string; timeField: string; columnsText: string }
interface MetricDraft { name: string; label: string; entity: string; agg: string; measure: string; dimensions: string; filters: string; formula: string; grain: string; extends: string }
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

function toConfig(d: LayerDraft): SemanticConfig {
  return {
    entities: d.entities.filter((e) => e.table.trim() !== '').map((e) => ({
      table: e.table.trim(),
      ...(e.label ? { label: e.label } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.timeField ? { timeField: e.timeField } : {}),
      ...(parseColumns(e.columnsText).length > 0 ? { columns: parseColumns(e.columnsText) } : {}),
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
    })),
    terms: d.terms.filter((t2) => t2.name.trim() !== '').map((t2) => ({
      name: t2.name.trim(),
      ...(t2.aliases.trim() ? { aliases: t2.aliases.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      description: t2.description,
    })),
  }
}

function fromConfig(c?: SemanticConfig): LayerDraft {
  return {
    entities: (c?.entities ?? []).map((e) => ({
      table: e.table, label: e.label ?? '', description: e.description ?? '',
      timeField: e.timeField ?? '', columnsText: serializeColumns(e.columns),
    })),
    metrics: (c?.metrics ?? []).map((m) => ({
      name: m.name, label: m.label ?? '', entity: m.entity, agg: m.agg,
      measure: m.measure ?? '', dimensions: (m.dimensions ?? []).join(', '),
      filters: (m.filters ?? []).join('\n'), formula: m.formula ?? '',
      grain: m.grain ?? '', extends: m.extends ?? '',
    })),
    terms: (c?.terms ?? []).map((t2) => ({
      name: t2.name, aliases: (t2.aliases ?? []).join(', '), description: t2.description,
    })),
  }
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
  const [wbStaged, setWbStaged] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [scaffoldDs, setScaffoldDs] = useState('')
  const [scaffolded, setScaffolded] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'editor'>('preview')

  // Stage the editor from the host-echoed workbench content once it arrives.
  useEffect(() => {
    if (wbStaged) return
    if (workbench !== undefined && workbench !== null) {
      setDraft(fromConfig(workbench))
      setWbStaged(true)
    }
  }, [rev]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to editor when workbench content is staged
  useEffect(() => {
    if (wbStaged && draft.entities.length > 0) {
      setActiveTab('editor')
      setEditing(true)
    }
  }, [wbStaged]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: keyof LayerDraft, index: number, field: string, value: string): void => {
    setSaved(false)
    setDraft((current) => {
      const list = (current[key] as unknown as Array<Record<string, unknown>>).map((item) => ({ ...item }))
      list[index] = { ...list[index], [field]: value }
      return { ...current, [key]: list } as LayerDraft
    })
  }
  const addRow = (key: keyof LayerDraft, row: EntityDraft | MetricDraft | TermDraft): void => {
    setSaved(false)
    setDraft((current) => {
      const list = [...(current[key] as unknown[]), row]
      return { ...current, [key]: list } as LayerDraft
    })
  }
  const removeRow = (key: keyof LayerDraft, index: number): void => {
    setSaved(false)
    setDraft((current) => {
      const list = (current[key] as unknown[]).filter((_, i) => i !== index)
      return { ...current, [key]: list } as LayerDraft
    })
  }

  const saveLayer = (): void => {
    setSaved(false)
    void scope.set('semanticWorkbench', toConfig(draft))
    setSaved(true)
  }

  const runScaffold = (): void => {
    if (scaffoldDs.trim() === '') return
    setScaffolded(false)
    void scope.set('scaffoldRequest', { datasource: scaffoldDs, nonce: Date.now() })
    setScaffolded(true)
    // Auto-open editor after scaffold
    setTimeout(() => {
      setActiveTab('editor')
      setEditing(true)
    }, 100)
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

  return (
    <div style={section}>
      <div style={sectionTitle}>{t('settings.semantic')}</div>
      <div style={muted}>{t('settings.semanticHint')}</div>

      {/* path input */}
      <div style={{ ...toolbar, marginTop: 8 }}>
        <label style={{ ...checkItem, flex: '1 1 320px' }}>
          <span style={checkText}>{t('settings.semanticPath')}</span>
          <input style={input} value={semanticFile} placeholder={t('settings.semanticPathPlaceholder')} onChange={(event) => setSemanticFile(event.target.value)} />
        </label>
      </div>

      {/* T0/T1 preview */}
      {summary && (
        <div style={preview}>
          <div style={statusRow}>
            <span style={statusChip(statusColor(summary.state))}>● {statusLabel(summary.state)}</span>
            <span style={countChip}>{t('settings.semanticEntities')} {summary.counts.entities}</span>
            <span style={countChip}>{t('settings.semanticMetrics')} {summary.counts.metrics}</span>
            <span style={countChip}>{t('settings.semanticTerms')} {summary.counts.terms}</span>
          </div>
          {summary.error !== undefined && <div style={errorBox}>{summary.error}</div>}

          {summary.metrics.length > 0 && (
            <div style={list}>
              {summary.metrics.map((m) => (
                <div key={m.name} style={metricRow}>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.label !== undefined && <span style={mutedFine}> · {m.label}</span>}
                  <span style={mutedFine}> · {m.entity} · {m.agg}{m.measure ? `(${m.measure})` : ''}</span>
                  {m.formula !== undefined && <div style={mutedFine}>{m.formula}</div>}
                </div>
              ))}
            </div>
          )}

          {/* T1 lint issues */}
          <div style={{ marginTop: 8 }}>
            <div style={labelStyle}>{t('settings.semanticIssues')}</div>
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
              </div>}
          </div>
        </div>
      )}

      {/* Tabs: Preview / Editor */}
      <div style={tabsContainer}>
        <button
          type="button"
          style={activeTab === 'preview' ? tabActive : tab}
          onClick={() => setActiveTab('preview')}
        >
          {t('settings.semanticPreview') ?? '预览'}
        </button>
        <button
          type="button"
          style={activeTab === 'editor' ? tabActive : tab}
          onClick={() => { setActiveTab('editor'); setEditing(true) }}
        >
          {t('settings.semanticEdit')}
        </button>
      </div>

      {/* T4 scaffold - inline in editor section */}
      {activeTab === 'editor' && (
        <div style={scaffoldBox}>
          <div style={scaffoldLabel}>{t('settings.semanticScaffold') ?? '从数据源生成起步语义层'}</div>
          <div style={{ ...toolbar, alignItems: 'center' }}>
            <select style={{ ...input, width: 200 }} value={scaffoldDs} onChange={(event) => setScaffoldDs(event.target.value)}>
              <option value="">{t('settings.defaultSourceAuto')}</option>
              {datasourceNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" style={actionButton} disabled={scaffoldDs.trim() === ''} onClick={runScaffold}>{t('settings.semanticScaffoldRun')}</button>
            {scaffolded && <span style={{ ...mutedFine, color: 'var(--rd-success)' }}>{t('settings.semanticScaffoldDone')}</span>}
          </div>
          <div style={mutedFine}>{t('settings.semanticScaffoldHint')}</div>
        </div>
      )}

      {/* Editor */}
      {activeTab === 'editor' && editing && (
        <div style={editor}>
          {saved && <div style={markBanner('var(--rd-success)')}>{t('settings.semanticDraftSaved')}</div>}

          {/* entities */}
          <div style={subTitle}>{t('settings.semanticEntities')}</div>
          {draft.entities.length === 0 && <div style={mutedFine}>{t('settings.semanticNoEntities')}</div>}
          {draft.entities.map((e, i) => (
            <div key={i} style={editRow}>
              <input style={mini} placeholder={t('settings.semanticEntityTable')} value={e.table} onChange={(ev) => patch('entities', i, 'table', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticEntityLabel')} value={e.label} onChange={(ev) => patch('entities', i, 'label', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticEntityTimeField')} value={e.timeField} onChange={(ev) => patch('entities', i, 'timeField', ev.target.value)} />
              <textarea style={textArea} placeholder={t('settings.semanticEntityColumns')} value={e.columnsText} onChange={(ev) => patch('entities', i, 'columnsText', ev.target.value)} />
              <input style={longInput} placeholder={t('settings.semanticEntityDesc')} value={e.description} onChange={(ev) => patch('entities', i, 'description', ev.target.value)} />
              <button type="button" style={delButton} onClick={() => removeRow('entities', i)}>{t('settings.semanticDelete')}</button>
            </div>
          ))}
          <button type="button" style={addButton} onClick={() => addRow('entities', { table: '', label: '', description: '', timeField: '', columnsText: '' })}>{t('settings.semanticAddEntity')}</button>

          {/* metrics */}
          <div style={subTitle}>{t('settings.semanticMetrics')}</div>
          {draft.metrics.length === 0 && <div style={mutedFine}>{t('settings.semanticNoMetrics')}</div>}
          {draft.metrics.map((m, i) => (
            <div key={i} style={editRow}>
              <input style={mini} placeholder={t('settings.semanticMetricName')} value={m.name} onChange={(ev) => patch('metrics', i, 'name', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticMetricLabel')} value={m.label} onChange={(ev) => patch('metrics', i, 'label', ev.target.value)} />
              <select style={mini} value={m.entity} onChange={(ev) => patch('metrics', i, 'entity', ev.target.value)}>
                <option value="">—</option>
                {draft.entities.map((e) => <option key={e.table} value={e.table}>{e.table}</option>)}
              </select>
              <select style={mini} value={m.agg} onChange={(ev) => patch('metrics', i, 'agg', ev.target.value)}>
                {METRIC_AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input style={mini} placeholder={t('settings.semanticMetricMeasure')} value={m.measure} onChange={(ev) => patch('metrics', i, 'measure', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticMetricDimensions')} value={m.dimensions} onChange={(ev) => patch('metrics', i, 'dimensions', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticMetricGrain')} value={m.grain} onChange={(ev) => patch('metrics', i, 'grain', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticMetricExtends')} value={m.extends} onChange={(ev) => patch('metrics', i, 'extends', ev.target.value)} />
              <input style={longInput} placeholder={t('settings.semanticMetricFilters')} value={m.filters} onChange={(ev) => patch('metrics', i, 'filters', ev.target.value)} />
              <input style={longInput} placeholder={t('settings.semanticMetricFormula')} value={m.formula} onChange={(ev) => patch('metrics', i, 'formula', ev.target.value)} />
              <button type="button" style={delButton} onClick={() => removeRow('metrics', i)}>{t('settings.semanticDelete')}</button>
            </div>
          ))}
          <button type="button" style={addButton} onClick={() => addRow('metrics', { name: '', label: '', entity: '', agg: 'sum', measure: '', dimensions: '', filters: '', formula: '', grain: '', extends: '' })}>{t('settings.semanticAddMetric')}</button>

          {/* terms */}
          <div style={subTitle}>{t('settings.semanticTerms')}</div>
          {draft.terms.length === 0 && <div style={mutedFine}>{t('settings.semanticNoTerms')}</div>}
          {draft.terms.map((tm, i) => (
            <div key={i} style={editRow}>
              <input style={mini} placeholder={t('settings.semanticTermName')} value={tm.name} onChange={(ev) => patch('terms', i, 'name', ev.target.value)} />
              <input style={mini} placeholder={t('settings.semanticTermAliases')} value={tm.aliases} onChange={(ev) => patch('terms', i, 'aliases', ev.target.value)} />
              <input style={longInput} placeholder={t('settings.semanticTermDesc')} value={tm.description} onChange={(ev) => patch('terms', i, 'description', ev.target.value)} />
              <button type="button" style={delButton} onClick={() => removeRow('terms', i)}>{t('settings.semanticDelete')}</button>
            </div>
          ))}
          <button type="button" style={addButton} onClick={() => addRow('terms', { name: '', aliases: '', description: '' })}>{t('settings.semanticAddTerm')}</button>

          <div style={{ marginTop: 10 }}>
            <button type="button" style={{ ...actionButton, ...saveEnabled }} onClick={saveLayer}>{t('settings.semanticSaveLayer')}</button>
          </div>
          <div style={mutedFine}>{t('settings.semanticLintHint')}</div>
        </div>
      )}
    </div>
  )
}

// --- styles (reuse the card's token vocabulary) ---
const section: React.CSSProperties = {
  border: '1px solid var(--rd-border)', borderRadius: 10,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }
const muted: React.CSSProperties = { color: 'var(--rd-muted)', lineHeight: 1.5, fontSize: 12 }
const mutedFine: React.CSSProperties = { ...muted, fontSize: 11 }
const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }
const checkItem: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'inherit' }
const checkText: React.CSSProperties = { whiteSpace: 'nowrap', color: 'var(--rd-muted)' }
const input: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 6,
  padding: '4px 8px', fontSize: 12, background: 'transparent', color: 'inherit', width: 140,
}
const actionButton: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 999,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '4px 12px',
}
const saveEnabled: React.CSSProperties = { borderColor: 'var(--rd-accent)', color: 'var(--rd-accent)', fontWeight: 600 }
const delButton: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--rd-muted)', cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 6,
}
const preview: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, borderTop: '1px dashed var(--rd-border)', paddingTop: 8 }
const statusRow: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
const statusChip = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
  color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`,
  borderRadius: 999, padding: '1px 8px',
})
const countChip: React.CSSProperties = { fontSize: 11, color: 'var(--rd-muted)', border: '1px solid var(--rd-border)', borderRadius: 999, padding: '1px 8px' }
const errorBox: React.CSSProperties = { fontSize: 11, color: 'var(--rd-error)', background: 'color-mix(in srgb, var(--rd-error) 8%, transparent)', borderRadius: 6, padding: '4px 8px' }
const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const metricRow: React.CSSProperties = { fontSize: 12, borderLeft: '2px solid var(--rd-border)', paddingLeft: 8 }
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--rd-muted)' }
const issueRow: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 12, borderLeft: '2px solid var(--rd-error)', paddingLeft: 8 }
const editor: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, borderTop: '1px dashed var(--rd-border)', paddingTop: 8 }
const subTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginTop: 4 }
const editRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', border: '1px solid var(--rd-border)', borderRadius: 8, padding: 6 }
const mini: React.CSSProperties = { border: '1px solid var(--rd-control-border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, background: 'transparent', color: 'inherit', width: 120 }
const longInput: React.CSSProperties = { border: '1px solid var(--rd-control-border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, background: 'transparent', color: 'inherit', flex: '1 1 200px', minWidth: 160 }
const textArea: React.CSSProperties = { border: '1px solid var(--rd-control-border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, background: 'transparent', color: 'inherit', width: '100%', minHeight: 48, resize: 'vertical', fontFamily: 'inherit' }
const addButton: React.CSSProperties = { alignSelf: 'flex-start', border: '1px dashed var(--rd-control-border)', borderRadius: 999, background: 'transparent', color: 'var(--rd-accent)', cursor: 'pointer', fontSize: 12, padding: '3px 12px' }
const markBanner = (color: string): React.CSSProperties => ({
  fontSize: 12, color, padding: '6px 10px', borderRadius: 8, background: `color-mix(in srgb, ${color} 8%, transparent)`,
})
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
