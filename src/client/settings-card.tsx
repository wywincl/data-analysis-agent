/**
 * 数据库工作台 settings card (browser half): live connection management for
 * the `data-analysis` settings namespace.
 *
 * Edits stage locally; 保存 writes `dataSources` (+ `semanticFile`) through
 * the bound settings scope — the Host hot-swaps providers and rewires the
 * semantic layer without a restart. Passwords are write-only (the schema
 * marks them secret, so stored values never echo back; a blank field keeps
 * the stored one).
 *
 * Interaction model:
 *  - Live per-field validation mirrors save() exactly: failing fields get an
 *    inline ⚠ message and a red border while typing, so problems surface
 *    before save instead of as a save-time throw, and invalid numbers can
 *    never be silently dropped.
 *  - The save/reset actions live on a sticky footer bar, so they stay visible
 *    (with a dirty / issues summary) no matter how far the form is scrolled.
 *  - The card is split into sub-tabs (数据连接 / 默认与全局 / 语义层) instead of
 *    one long scroll; inactive areas stay mounted so staged edits and the
 *    semantic draft survive tab switches, and the footer state spans all tabs.
 *  - Delete / reset are two-step buttons (click again within 3s) — no
 *    native dialogs, no accidental data loss.
 *  - The saved banner auto-dismisses; a disabled save button explains why
 *    via the footer status line.
 *  - Clearing a global default restores the built-in default on save (the
 *    store would otherwise keep the previous value forever).
 *  - 默认数据源 is a chip selector: one click picks a source (status dot
 *    included), clicking 自动 again lets the model decide.
 *
 * NOTE on reactivity: the store snapshot's section object must not be synced
 * during render (an unstable identity would loop React); subscription lives in
 * an effect and the form stages once when the section first arrives. 重置
 * re-stages from the store.
 *
 * @module dsh-data-analysis/client/settings-card
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientKey } from '../i18n/client.ts'
import { rdVars, tokensFor } from './theme.ts'
import { SemanticSection } from './semantic-section.tsx'
import {
  WorkbenchStyles, WB_ROOT, Field, Switch, inputFull, inputErrorClass,
  btnPrimary, btnGhost, btnDangerGhost, cardBox, fieldGrid, chipStyle,
} from './workbench-ui.tsx'
import type { HealthStatus } from '../health.ts'
import type { SemanticSummary, SemanticConfig } from '../semantic/types.ts'

type Translate = (key: ClientKey, params?: Record<string, unknown>) => string

/** The namespace fields this card edits (subset of the plugin config). */
export interface WorkbenchSection {
  dataSources?: {
    name: string
    type: 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark' | 'duckdb'
    file?: string
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
    ssl?: boolean
    approvalMode?: 'auto' | 'ask'
    maxRows?: number
    timeoutMs?: number
    sparkMock?: boolean
    livyUrl?: string
  }[]
  semanticFile?: string
  defaultDatasource?: string
  /** Live connectivity probe results keyed by datasource name. */
  health?: Record<string, HealthStatus>
  /** One-shot test request written by the card; the host consumes it. */
  testRequest?: { name: string, nonce: number } | null
  /** Read-only preview of the semantic layer, pushed live by the host. */
  semanticSummary?: SemanticSummary
  /** Author-ed semantic content owned by the workbench editor. */
  semanticWorkbench?: SemanticConfig
  /** One-shot scaffold request written by the card; the host consumes it. */
  scaffoldRequest?: { datasource: string, nonce: number } | null
  defaultMaxRows?: number
  defaultTimeoutMs?: number
  modelRowCap?: number
  chartDataCap?: number
  schemaCacheTtlMs?: number
  exportDir?: string
}

/** One editable connection row (string-typed form fields). */
interface Row {
  name: string
  type: 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark' | 'duckdb'
  file: string
  host: string
  port: string
  user: string
  password: string
  database: string
  approvalMode: 'auto' | 'ask'
  maxRows: string
  timeoutMs: string
  ssl: boolean
  sparkMock: boolean
  livyUrl: string
}

/** One validation problem, attached to the form field it belongs to. */
interface RowIssue {
  field: keyof Row | null
  message: string
}

/** The workbench sub-tabs. */
type WorkbenchSectionId = 'connections' | 'globals' | 'semantic'

const TYPES: Row['type'][] = ['sqlite', 'mysql', 'postgres', 'clickhouse', 'duckdb', 'spark']

/** Identity hue per datasource type — the dot lets users scan the list. */
const TYPE_COLORS: Record<Row['type'], string> = {
  sqlite: '#12b76a',
  mysql: '#4479a1',
  postgres: '#336791',
  clickhouse: '#f59e0b',
  duckdb: '#a16207',
  spark: '#e25a1c',
}

function emptyRow(): Row {
  return { name: '', type: 'mysql', file: '', host: '', port: '', user: '', password: '', database: '', approvalMode: 'auto', maxRows: '', timeoutMs: '', ssl: false, sparkMock: true, livyUrl: '' }
}

function toRows(section: WorkbenchSection | undefined): Row[] {
  return (section?.dataSources ?? []).map((ds) => ({
    name: ds.name,
    type: ds.type,
    file: ds.file ?? '',
    host: ds.host ?? '',
    port: ds.port !== undefined ? String(ds.port) : '',
    user: ds.user ?? '',
    password: '',
    database: ds.database ?? '',
    approvalMode: ds.approvalMode ?? 'auto',
    maxRows: ds.maxRows !== undefined ? String(ds.maxRows) : '',
    timeoutMs: ds.timeoutMs !== undefined ? String(ds.timeoutMs) : '',
    ssl: ds.ssl ?? false,
    sparkMock: ds.sparkMock ?? true,
    livyUrl: ds.livyUrl ?? '',
  }))
}

function fromRows(rows: Row[]): NonNullable<WorkbenchSection['dataSources']> {
  return rows
    .filter((row) => row.name.trim() !== '')
    .map((row) => {
      const port = Number.parseInt(row.port, 10)
      const maxRows = Number.parseInt(row.maxRows, 10)
      const timeoutMs = Number.parseInt(row.timeoutMs, 10)
      return {
        name: row.name.trim(),
        type: row.type,
        // sqlite AND duckdb are file-backed; losing `file` on save would brick them.
        ...(row.type === 'sqlite' || row.type === 'duckdb'
          ? { file: row.file }
          : {
              host: row.host,
              database: row.database,
              ...(row.user !== '' ? { user: row.user } : {}),
              ...(row.password !== '' ? { password: row.password } : {}),
              ...(Number.isFinite(port) ? { port } : {}),
              ssl: row.ssl,
            }),
        approvalMode: row.approvalMode,
        ...(Number.isFinite(maxRows) ? { maxRows } : {}),
        ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
        ...(row.type === 'spark'
          ? {
              sparkMock: row.sparkMock,
              ...(row.livyUrl.trim() !== '' ? { livyUrl: row.livyUrl.trim() } : {}),
            }
          : {}),
      }
    })
}

const DEFAULT_FIELDS = [
  'defaultMaxRows', 'defaultTimeoutMs', 'modelRowCap', 'chartDataCap', 'schemaCacheTtlMs', 'exportDir',
] as const

/** Built-in schema defaults — clearing a field restores these on save. */
const BUILTIN_DEFAULTS: Record<(typeof DEFAULT_FIELDS)[number], string | number> = {
  defaultMaxRows: 500,
  defaultTimeoutMs: 20_000,
  modelRowCap: 50,
  chartDataCap: 500,
  schemaCacheTtlMs: 300_000,
  exportDir: '',
}

/** Extract the editable global-defaults as string form fields. */
function toDefaults(section: WorkbenchSection | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of DEFAULT_FIELDS) {
    const value = (section as Record<string, unknown> | undefined)?.[key]
    out[key] = value !== undefined ? String(value) : ''
  }
  return out
}

/** Merge string defaults back into numeric/string config fields. Blank
 * restores the built-in default (written explicitly — the store would keep
 * the previous value otherwise); invalid numbers are rejected upstream. */
function fromDefaults(defaults: Record<string, string>): Partial<WorkbenchSection> {
  const out: Record<string, string | number> = {}
  for (const key of DEFAULT_FIELDS) {
    const raw = (defaults[key] ?? '').trim()
    if (raw === '') {
      out[key] = BUILTIN_DEFAULTS[key]
    } else if (key === 'exportDir') {
      out[key] = raw
    } else {
      const numeric = Number(raw)
      if (Number.isFinite(numeric)) out[key] = numeric
    }
  }
  return out as Partial<WorkbenchSection>
}

/** Per-row live validation — must stay in sync with what save() would do,
 * so a row that passes here never surprises at save time. Issues carry the
 * field they belong to so the form can highlight them inline. */
function rowIssues(row: Row, all: Row[], t: Translate): RowIssue[] {
  const name = row.name.trim()
  const label = name === '' ? '?' : name
  const issues: RowIssue[] = []
  if (name === '') issues.push({ field: 'name', message: t('settings.nameRequired') })
  else if (all.filter((other) => other.name.trim() === name).length > 1) issues.push({ field: 'name', message: t('settings.duplicateName', { name }) })
  if (row.type === 'sqlite' || row.type === 'duckdb') {
    if (row.file.trim() === '') issues.push({ field: 'file', message: t('settings.fileRequired', { name: label }) })
  } else if (row.type === 'spark') {
    if (row.sparkMock === false && row.livyUrl.trim() === '') issues.push({ field: 'livyUrl', message: t('settings.livyUrlRequired', { name: label }) })
  } else {
    const remote = t('settings.remoteHostRequired', { name: label, type: row.type })
    if (row.host.trim() === '') issues.push({ field: 'host', message: remote })
    if (row.database.trim() === '') issues.push({ field: 'database', message: remote })
  }
  const numeric: [keyof Row, string, string][] = [
    ['port', t('settings.port'), row.port],
    ['maxRows', t('settings.rowLimit'), row.maxRows],
    ['timeoutMs', t('settings.timeoutMs'), row.timeoutMs],
  ]
  for (const [field, fieldLabel, raw] of numeric) {
    if (raw.trim() !== '' && !Number.isFinite(Number(raw))) {
      issues.push({ field, message: t('settings.invalidNumberField', { name: label, field: fieldLabel }) })
    }
  }
  return issues
}

/** Global-defaults validation (numeric fields only), field-attached. */
function defaultsIssues(defaults: Record<string, string>, t: Translate): { field: string, message: string }[] {
  const labelOf: Partial<Record<(typeof DEFAULT_FIELDS)[number], ClientKey>> = {
    defaultMaxRows: 'settings.rowLimit',
    defaultTimeoutMs: 'settings.timeoutMs',
    modelRowCap: 'settings.modelRowCap',
    chartDataCap: 'settings.chartDataCap',
    schemaCacheTtlMs: 'settings.schemaCacheLabel',
  }
  const issues: { field: string, message: string }[] = []
  for (const key of DEFAULT_FIELDS) {
    if (key === 'exportDir') continue
    const raw = (defaults[key] ?? '').trim()
    const labelKey = labelOf[key]
    if (raw !== '' && !Number.isFinite(Number(raw)) && labelKey !== undefined) {
      issues.push({ field: key, message: t('settings.invalidNumberShort', { field: t(labelKey) }) })
    }
  }
  return issues
}

export function DataWorkbenchCard({ scope, t }: { scope: SettingsScope<WorkbenchSection>; t: Translate }): ReactNode {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [rows, setRows] = useState<Row[]>([])
  const [semanticFile, setSemanticFile] = useState('')
  const [defaultDatasource, setDefaultDatasource] = useState('')
  // Appearance always follows the host/system light/dark mode via the
  // `--dsw-alias-*` tokens (tokensFor('auto')); there is no manual override.
  const vars = rdVars(tokensFor('auto'))
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [staged, setStaged] = useState(false)
  // `rev` bumps on every settings snapshot change; declared before the
  // health/pending block so the clearing effect can depend on it.
  const [rev, setRev] = useState(0)
  // Two-step confirmations (delete row / reset): the first click arms the
  // button for 3s, the second click acts. No native dialogs.
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // Sub-tab navigation. Inactive areas stay mounted (display:none) so staged
  // edits and the semantic draft survive switching tabs.
  const [section, setSection] = useState<WorkbenchSectionId>('connections')
  const deleteTimer = useRef<number | undefined>(undefined)
  const resetTimer = useRef<number | undefined>(undefined)

  // Live connectivity status: read from the snapshot every render (the
  // subscription bumps `rev`, so the card re-renders when health arrives).
  const health = (scope.getSnapshot().value?.health ?? {}) as Record<string, HealthStatus>
  // Semantic summary feeds the 语义层 tab badge (the section reads it too).
  const semanticSummary = scope.getSnapshot().value?.semanticSummary
  // Names currently being probed (value = click timestamp, used to clear once
  // the matching result lands).
  const [pending, setPending] = useState<Record<string, number>>({})

  // Clear a pending entry once its probe result has landed (at >= click time).
  useEffect(() => {
    setPending((current) => {
      let changed = false
      const nextPending = { ...current }
      for (const name of Object.keys(nextPending)) {
        const status = health[name]
        if (status !== undefined && status.at >= nextPending[name]) {
          delete nextPending[name]
          changed = true
        }
      }
      return changed ? nextPending : current
    })
  }, [rev]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Request a one-shot connectivity test for `name` from the host. */
  const testConnection = (name: string): void => {
    if (name.trim() === '') return
    const nonce = Date.now()
    setPending((current) => ({ ...current, [name]: nonce }))
    setSaveState('idle')
    void scope.set('testRequest', { name, nonce })
  }

  // Subscription lives in an effect: store notifications bump a revision and
  // the staging effect below re-checks — never read the store during render.
  useEffect(() => scope.subscribe(() => { setRev((n) => n + 1) }), [scope])

  // Stage the form once the Host's section first arrives (and on 重置).
  useEffect(() => {
    if (staged) return
    const snapshot = scope.getSnapshot()
    if (snapshot.status === 'ready' && snapshot.value !== undefined) {
      setRows(toRows(snapshot.value))
      setSemanticFile(snapshot.value.semanticFile ?? '')
      setDefaultDatasource(snapshot.value.defaultDatasource ?? '')
      setDefaults(toDefaults(snapshot.value))
      setStatus('ready')
      setStaged(true)
    } else if (snapshot.status === 'unavailable') {
      setStatus('unavailable')
      setStaged(true)
    }
  }, [scope, staged, rev])

  // The saved banner self-dismisses; errors stay until the next action.
  useEffect(() => {
    if (saveState !== 'saved') return
    const timer = window.setTimeout(() => { setSaveState('idle') }, 4000)
    return () => { window.clearTimeout(timer) }
  }, [saveState])

  // Disarm pending confirmations and their timers on unmount.
  useEffect(() => () => {
    window.clearTimeout(deleteTimer.current)
    window.clearTimeout(resetTimer.current)
  }, [])

  const restage = (): void => {
    const snapshot = scope.getSnapshot()
    setRows(toRows(snapshot.value))
    setSemanticFile(snapshot.value?.semanticFile ?? '')
    setDefaultDatasource(snapshot.value?.defaultDatasource ?? '')
    setDefaults(toDefaults(snapshot.value))
    setDirty(false)
    setSaveState('idle')
  }

  const clickDelete = (index: number): void => {
    window.clearTimeout(resetTimer.current)
    setConfirmReset(false)
    if (confirmDeleteRow === index) {
      setConfirmDeleteRow(null)
      setDirty(true)
      setSaveState('idle')
      setRows((current) => current.filter((_, i) => i !== index))
      return
    }
    setConfirmDeleteRow(index)
    window.clearTimeout(deleteTimer.current)
    deleteTimer.current = window.setTimeout(() => { setConfirmDeleteRow(null) }, 3000)
  }

  const clickReset = (): void => {
    window.clearTimeout(deleteTimer.current)
    setConfirmDeleteRow(null)
    if (confirmReset) {
      setConfirmReset(false)
      restage()
      return
    }
    setConfirmReset(true)
    resetTimer.current = window.setTimeout(() => { setConfirmReset(false) }, 3000)
  }

  const update = (patch: Partial<Row>, index: number): void => {
    setDirty(true)
    setSaveState('idle')
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /** Curried onChange for the global-defaults string fields. */
  const setDefault = (key: string) => (event: { target: { value: string } }): void => {
    setDirty(true)
    setSaveState('idle')
    setDefaults((current) => ({ ...current, [key]: event.target.value }))
  }

  // Live validation drives the inline field errors and the save button.
  const rowIssueList = rows.map((row) => rowIssues(row, rows, t))
  const defaultsProblem = defaultsIssues(defaults, t)
  const issueCount = rowIssueList.reduce((sum, list) => sum + list.length, 0) + defaultsProblem.length
  const saveDisabled = !dirty || saveState === 'saving' || issueCount > 0

  const save = async (): Promise<void> => {
    // Same validators the UI shows inline — a disabled-looking save can also
    // be reached via keyboard, so keep this as the authoritative gate.
    const problems = [...rowIssueList.flat().map((issue) => issue.message), ...defaultsProblem.map((issue) => issue.message)]
    if (problems.length > 0) {
      setSaveState('error')
      setError(problems.length > 1 ? `${problems[0]} (+${problems.length - 1})` : problems[0]!)
      return
    }
    setSaveState('saving')
    setError('')
    try {
      const next = fromRows(rows)
      await scope.set('dataSources', JSON.parse(JSON.stringify(next)))
      if (semanticFile !== (scope.getSnapshot().value?.semanticFile ?? '')) {
        await scope.set('semanticFile', semanticFile)
      }
      if (defaultDatasource !== (scope.getSnapshot().value?.defaultDatasource ?? '')) {
        await scope.set('defaultDatasource', defaultDatasource)
      }
      const defaultPatch = fromDefaults(defaults)
      for (const [key, value] of Object.entries(defaultPatch)) {
        if (String(scope.getSnapshot().value?.[key as keyof WorkbenchSection] ?? '') !== String(value)) {
          await scope.set(key as keyof WorkbenchSection, value)
        }
      }
      setDirty(false)
      setSaveState('saved')
    } catch (saveError) {
      setSaveState('error')
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  const addConnection = (): void => {
    setDirty(true)
    setSaveState('idle')
    setConfirmDeleteRow(null)
    setSection('connections')
    setRows((current) => [...current, emptyRow()])
  }

  if (status === 'unavailable') {
    return (
      <div className={WB_ROOT} style={{ ...root, ...vars }}>
        <WorkbenchStyles />
        <div style={title}>{t('settings.title')}</div>
        <div style={muted}>{t('settings.unavailable')}</div>
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className={WB_ROOT} style={{ ...root, ...vars }}>
        <WorkbenchStyles />
        <div style={title}>{t('settings.title')}</div>
        <div style={muted}>{t('settings.loading')}</div>
      </div>
    )
  }

  // Per-row issues grouped by field for inline highlighting.
  const fieldIssue = (rowIndex: number, field: keyof Row): string | undefined =>
    rowIssueList[rowIndex]?.find((issue) => issue.field === field)?.message
  // Fields whose message already renders inline under the control; every
  // other issue (name/maxRows/timeoutMs + cross-field) lists in the card box.
  const inlineField = new Set<string>(['file', 'host', 'database', 'livyUrl', 'port'])
  const rowBoxIssues = (rowIndex: number): string[] =>
    rowIssueList[rowIndex]
      ?.filter((issue) => issue.field === null || !inlineField.has(issue.field))
      .map((issue) => issue.message) ?? []
  const defaultFieldIssue = (key: string): string | undefined =>
    defaultsProblem.find((issue) => issue.field === key)?.message

  // Sticky-footer status line: what blocks saving / what just happened.
  const footerStatus = saveState === 'error'
    ? { text: error, color: 'var(--rd-error)' }
    : saveState === 'saved'
      ? { text: t('settings.saved'), color: 'var(--rd-success)' }
      : issueCount > 0
        ? { text: `⚠ ${t('settings.fixIssuesHint')}`, color: 'var(--rd-error)' }
        : dirty
          ? { text: t('settings.unsaved'), color: 'var(--rd-accent)' }
          : null

  // Sub-tab badges: red warn chip on problems, muted count chip otherwise.
  const connectionWarn = rowIssueList.reduce((sum, list) => sum + list.length, 0)
  const semanticWarn = semanticSummary === undefined
    ? 0
    : semanticSummary.issues.length + (semanticSummary.state === 'parse-error' || semanticSummary.state === 'missing' ? 1 : 0)
  const tabDefs: { id: WorkbenchSectionId; label: string; count?: number; warn?: number }[] = [
    { id: 'connections', label: t('settings.tabConnections'), count: rows.length, warn: connectionWarn },
    { id: 'globals', label: t('settings.tabGlobals'), warn: defaultsProblem.length },
    { id: 'semantic', label: t('settings.tabSemantic'), warn: semanticWarn },
  ]

  return (
    <div className={WB_ROOT} style={{ ...root, ...vars }}>
      <WorkbenchStyles />
      <div style={headerRow}>
        <div style={{ minWidth: 0 }}>
          <div style={title}>{t('settings.title')}</div>
          <div style={muted} dangerouslySetInnerHTML={{ __html: t('settings.subtitle') }} />
        </div>
      </div>

      {/* sub-tab 导航：三个配置区域；保存栏跨 tab 共享 */}
      <div style={subTabs}>
        {tabDefs.map((tabDef) => (
          <button key={tabDef.id} type="button" style={section === tabDef.id ? subTabActive : subTab} onClick={() => setSection(tabDef.id)}>
            {tabDef.label}
            {(tabDef.warn ?? 0) > 0
              ? <span style={tabWarn}>⚠ {tabDef.warn}</span>
              : tabDef.count !== undefined && <span style={tabCount}>{tabDef.count}</span>}
          </button>
        ))}
      </div>

      {/* 数据连接卡片 */}
      <div style={{ display: section === 'connections' ? 'contents' : 'none' }}>
      {rows.length === 0 && (
        <div style={emptyHero}>
          <div style={{ fontSize: 24, lineHeight: 1 }}>🗄️</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.emptyTitle')}</div>
          <div style={{ ...muted, textAlign: 'center', maxWidth: 420 }}>{t('settings.emptyHint')}</div>
          <button type="button" style={{ ...btnPrimary, marginTop: 4 }} onClick={addConnection}>{t('settings.addFirst')}</button>
        </div>
      )}
      <div style={cards}>
        {rows.map((row, index) => {
          const isFileBacked = row.type === 'sqlite' || row.type === 'duckdb'
          const isRemote = row.type !== 'sqlite' && row.type !== 'duckdb'
          return (
            <div key={index} style={cardBox}>
              <div style={cardHeader}>
                <div style={cardTitleRow}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: TYPE_COLORS[row.type], flex: 'none' }} />
                  <input
                    className="rdwb-name-input"
                    style={nameInput}
                    value={row.name}
                    placeholder={t('settings.namePlaceholder')}
                    aria-label={t('settings.namePlaceholder')}
                    onChange={(event) => update({ name: event.target.value }, index)}
                  />
                  <span style={badge}>{row.type}</span>
                  <StatusChip status={health[row.name]} pending={pending[row.name] !== undefined} t={t} />
                </div>
                <div style={cardHeaderActions}>
                  <button
                    type="button"
                    style={{ ...btnGhost, padding: '4px 10px', fontSize: 12, color: 'var(--rd-accent)' }}
                    disabled={row.name.trim() === '' || pending[row.name] !== undefined}
                    onClick={() => testConnection(row.name)}
                  >
                    {pending[row.name] !== undefined ? t('settings.testing') : t('settings.testConnection')}
                  </button>
                  <button
                    type="button"
                    style={{ ...btnDangerGhost, ...(confirmDeleteRow === index ? { color: 'var(--rd-error)', borderColor: 'var(--rd-error)', fontWeight: 600 } : {}) }}
                    title={confirmDeleteRow === index ? undefined : t('settings.delete')}
                    onClick={() => clickDelete(index)}
                  >
                    {confirmDeleteRow === index ? t('settings.confirmDelete') : t('settings.delete')}
                  </button>
                </div>
              </div>

              <div style={fieldGrid}>
                <Field label={t('settings.type')}>
                  <select
                    style={inputFull}
                    value={row.type}
                    onChange={(event) => update({ type: event.target.value as Row['type'] }, index)}
                  >
                    {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>

                {isFileBacked ? (
                  <Field label={t('settings.fileOrHost.sqlite')} span error={fieldIssue(index, 'file')}>
                    <input
                      style={inputFull}
                      className={fieldIssue(index, 'file') !== undefined ? inputErrorClass : undefined}
                      value={row.file}
                      placeholder={t('settings.filePlaceholder')}
                      onChange={(event) => update({ file: event.target.value }, index)}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label={t('settings.fileOrHost.remote')} error={fieldIssue(index, 'host')}>
                      <input
                        style={inputFull}
                        className={fieldIssue(index, 'host') !== undefined ? inputErrorClass : undefined}
                        value={row.host}
                        placeholder={t('settings.hostPlaceholder')}
                        onChange={(event) => update({ host: event.target.value }, index)}
                      />
                    </Field>
                    <Field label={t('settings.port')} error={fieldIssue(index, 'port')}>
                      <input
                        style={inputFull}
                        className={fieldIssue(index, 'port') !== undefined ? inputErrorClass : undefined}
                        inputMode="numeric"
                        value={row.port}
                        placeholder={t(`settings.defaultPort.${row.type}` as ClientKey)}
                        onChange={(event) => update({ port: event.target.value }, index)}
                      />
                    </Field>
                    <Field label={t('settings.database')} error={fieldIssue(index, 'database')}>
                      <input
                        style={inputFull}
                        className={fieldIssue(index, 'database') !== undefined ? inputErrorClass : undefined}
                        value={row.database}
                        placeholder="database"
                        onChange={(event) => update({ database: event.target.value }, index)}
                      />
                    </Field>
                    <Field label={t('settings.user')}>
                      <input style={inputFull} value={row.user} placeholder="user" onChange={(event) => update({ user: event.target.value }, index)} />
                    </Field>
                    <Field label={t('settings.password')}>
                      <input
                        style={inputFull}
                        type="password"
                        value={row.password}
                        placeholder={t('settings.passwordPlaceholder')}
                        aria-label={t('settings.password')}
                        onChange={(event) => update({ password: event.target.value }, index)}
                      />
                    </Field>
                  </>
                )}

                {row.type === 'spark' && row.sparkMock === false && (
                  <Field label={t('settings.livyUrl')} span error={fieldIssue(index, 'livyUrl')}>
                    <input
                      style={inputFull}
                      className={fieldIssue(index, 'livyUrl') !== undefined ? inputErrorClass : undefined}
                      value={row.livyUrl}
                      placeholder={t('settings.livyUrlPlaceholder')}
                      onChange={(event) => update({ livyUrl: event.target.value }, index)}
                    />
                  </Field>
                )}
              </div>

              <div style={governRow}>
                <div style={governLabel}>{t('settings.groupGovernance')}</div>
                <div style={governItems}>
                  {row.type === 'sqlite' ? (
                    <span style={mutedFine}>{t('settings.sqliteNoApproval')}</span>
                  ) : row.type === 'duckdb' ? (
                    <span style={mutedFine}>{t('settings.fileNoApproval')}</span>
                  ) : (
                    <Switch
                      label={t('settings.approvalAsk')}
                      checked={row.approvalMode === 'ask'}
                      onChange={(next) => update({ approvalMode: next ? 'ask' : 'auto' }, index)}
                    />
                  )}
                  {row.type === 'spark' && (
                    <Switch label={t('settings.mock')} checked={row.sparkMock} onChange={(next) => update({ sparkMock: next }, index)} />
                  )}
                  {isRemote && (
                    <Switch label={t('settings.ssl')} checked={row.ssl} onChange={(next) => update({ ssl: next }, index)} />
                  )}
                  <span style={limitField}>
                    <span style={checkText}>{t('settings.rowLimit')}</span>
                    <input
                      style={miniInput}
                      className={fieldIssue(index, 'maxRows') !== undefined ? inputErrorClass : undefined}
                      inputMode="numeric"
                      value={row.maxRows}
                      placeholder={t('settings.fallback')}
                      onChange={(event) => update({ maxRows: event.target.value }, index)}
                    />
                  </span>
                  <span style={limitField}>
                    <span style={checkText}>{t('settings.timeoutMs')}</span>
                    <input
                      style={miniInput}
                      className={fieldIssue(index, 'timeoutMs') !== undefined ? inputErrorClass : undefined}
                      inputMode="numeric"
                      value={row.timeoutMs}
                      placeholder={t('settings.fallback')}
                      onChange={(event) => update({ timeoutMs: event.target.value }, index)}
                    />
                  </span>
                </div>
              </div>

              {rowBoxIssues(index).length > 0 && (
                <div style={issuesBox}>
                  {rowBoxIssues(index).map((message, issueIndex) => (
                    <div key={issueIndex} style={issueLine}>⚠ {message}</div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {rows.length > 0 && (
        <button type="button" className="rdwb-add" style={addConnectionBtn} onClick={addConnection}>{t('settings.addConnection')}</button>
      )}
      </div>

      {/* 默认数据源 + 全局默认 + 主题脚注 */}
      <div style={{ display: section === 'globals' ? 'contents' : 'none' }}>
      {/* 默认数据源：chip 选择器 */}
      <div style={cardBox}>
        <div style={sectionTitle}>{t('settings.defaultSource')}</div>
        <div style={muted}>{t('settings.defaultSourceHint')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="rdwb-chip-opt"
            style={defaultDatasource === '' ? chipSelected : chipOption}
            onClick={() => { setDirty(true); setSaveState('idle'); setDefaultDatasource('') }}
          >
            {t('settings.defaultSourceAuto')}
          </button>
          {rows.filter((row) => row.name.trim() !== '').map((row) => (
            <button
              key={row.name}
              type="button"
              className="rdwb-chip-opt"
              style={defaultDatasource === row.name ? chipSelected : chipOption}
              onClick={() => { setDirty(true); setSaveState('idle'); setDefaultDatasource(row.name) }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, background: TYPE_COLORS[row.type], flex: 'none' }} />
              {row.name}
              <span style={{ opacity: 0.65, fontWeight: 400 }}>{row.type}</span>
              {health[row.name]?.online === true && <span style={{ color: 'var(--rd-success)' }}>●</span>}
              {health[row.name]?.online === false && <span style={{ color: 'var(--rd-error)' }}>●</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 全局默认 */}
      <div style={cardBox}>
        <div style={sectionTitle}>{t('settings.globalDefaults')}</div>
        <div style={muted}>{t('settings.globalDefaultsHint')}</div>
        <div style={fieldGrid}>
          <Field label={t('settings.rowLimit')} error={defaultFieldIssue('defaultMaxRows')}>
            <input
              style={inputFull}
              className={defaultFieldIssue('defaultMaxRows') !== undefined ? inputErrorClass : undefined}
              inputMode="numeric"
              value={defaults.defaultMaxRows ?? ''}
              placeholder={String(BUILTIN_DEFAULTS.defaultMaxRows)}
              onChange={setDefault('defaultMaxRows')}
            />
          </Field>
          <Field label={t('settings.timeoutMs')} error={defaultFieldIssue('defaultTimeoutMs')}>
            <input
              style={inputFull}
              className={defaultFieldIssue('defaultTimeoutMs') !== undefined ? inputErrorClass : undefined}
              inputMode="numeric"
              value={defaults.defaultTimeoutMs ?? ''}
              placeholder={String(BUILTIN_DEFAULTS.defaultTimeoutMs)}
              onChange={setDefault('defaultTimeoutMs')}
            />
          </Field>
          <Field label={t('settings.modelRowCap')} error={defaultFieldIssue('modelRowCap')}>
            <input
              style={inputFull}
              className={defaultFieldIssue('modelRowCap') !== undefined ? inputErrorClass : undefined}
              inputMode="numeric"
              value={defaults.modelRowCap ?? ''}
              placeholder={String(BUILTIN_DEFAULTS.modelRowCap)}
              onChange={setDefault('modelRowCap')}
            />
          </Field>
          <Field label={t('settings.chartDataCap')} error={defaultFieldIssue('chartDataCap')}>
            <input
              style={inputFull}
              className={defaultFieldIssue('chartDataCap') !== undefined ? inputErrorClass : undefined}
              inputMode="numeric"
              value={defaults.chartDataCap ?? ''}
              placeholder={String(BUILTIN_DEFAULTS.chartDataCap)}
              onChange={setDefault('chartDataCap')}
            />
          </Field>
          <Field label={t('settings.schemaCacheLabel')} error={defaultFieldIssue('schemaCacheTtlMs')}>
            <input
              style={inputFull}
              className={defaultFieldIssue('schemaCacheTtlMs') !== undefined ? inputErrorClass : undefined}
              inputMode="numeric"
              value={defaults.schemaCacheTtlMs ?? ''}
              placeholder={String(BUILTIN_DEFAULTS.schemaCacheTtlMs)}
              onChange={setDefault('schemaCacheTtlMs')}
            />
          </Field>
          <Field label={t('settings.exportDirLabel')} span>
            <input
              style={inputFull}
              value={defaults.exportDir ?? ''}
              placeholder="~/Downloads/dsh-exports"
              onChange={setDefault('exportDir')}
            />
          </Field>
        </div>
      </div>

      {/* 外观主题：自动跟随系统 light/dark（脚注） */}
      <div style={{ ...mutedFine, borderTop: '1px dashed var(--rd-border)', paddingTop: 8 }}>{t('settings.themeHint')}</div>
      </div>

      {/* 语义层：路径 + 预览 + 编辑 + 生成 */}
      <div style={{ display: section === 'semantic' ? 'contents' : 'none' }}>
      <SemanticSection
        scope={scope}
        t={t}
        semanticFile={semanticFile}
        setSemanticFile={(value) => { setDirty(true); setSaveState('idle'); setSemanticFile(value) }}
        datasourceNames={rows.filter((row) => row.name.trim() !== '').map((row) => row.name)}
      />
      </div>

      {/* 吸底操作栏：状态 + 保存/重置，滚动时始终可见 */}
      <div style={stickyBar}>
        <div style={{ ...footerStatusStyle, color: footerStatus?.color ?? 'var(--rd-muted)' }}>
          {saveState === 'saving' ? t('settings.saving') : footerStatus?.text ?? ''}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            style={{ ...btnDangerGhost, ...(confirmReset ? { color: 'var(--rd-error)', borderColor: 'var(--rd-error)', fontWeight: 600 } : {}) }}
            disabled={!dirty}
            title={!dirty ? t('settings.noChanges') : undefined}
            onClick={clickReset}
          >
            {confirmReset ? t('settings.confirmReset') : t('settings.reset')}
          </button>
          <button
            type="button"
            style={btnPrimary}
            disabled={saveDisabled}
            title={issueCount > 0 ? t('settings.fixIssuesHint') : !dirty ? t('settings.noChanges') : undefined}
            onClick={() => { void save() }}
          >
            {saveState === 'saving' ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Connectivity status chip: testing / online / offline / not-tested. */
function StatusChip({ status, pending, t }: { status: HealthStatus | undefined, pending: boolean, t: Translate }): ReactNode {
  if (pending) return <span style={chipStyle('var(--rd-accent)')} title={t('settings.testing')}>● {t('settings.testing')}</span>
  if (status?.online === true) {
    const testedAt = status.at !== undefined
      ? t('settings.lastTestedAt', { time: new Date(status.at).toLocaleTimeString([], { hour12: false }) })
      : undefined
    return <span style={chipStyle('var(--rd-success)')} title={testedAt ?? t('settings.online')}>● {t('settings.online')}</span>
  }
  if (status?.online === false) {
    const testedAt = status.at !== undefined
      ? ` · ${t('settings.lastTestedAt', { time: new Date(status.at).toLocaleTimeString([], { hour12: false }) })}`
      : ''
    return <span style={chipStyle('var(--rd-error)')} title={`${status.message ?? t('settings.offline')}${testedAt}`}>● {t('settings.offline')}</span>
  }
  return <span style={chipStyle('var(--rd-muted)')} title={t('settings.notTested')}>○ {t('settings.notTested')}</span>
}

// --- styles ---

const root: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--rd-text)', maxWidth: 880 }
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }
const addConnectionBtn: React.CSSProperties = {
  alignSelf: 'flex-start', border: '1px dashed var(--rd-control-border)', borderRadius: 999,
  background: 'transparent', color: 'var(--rd-accent)', cursor: 'pointer', fontSize: 12.5, padding: '6px 16px',
}
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 2 }
const muted: React.CSSProperties = { color: 'var(--rd-muted)', lineHeight: 1.5, fontSize: 12.5 }
const mutedFine: React.CSSProperties = { ...muted, fontSize: 11 }

const cards: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const cardHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }
const cardTitleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }
const cardHeaderActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 }
const nameInput: React.CSSProperties = {
  border: '1px solid transparent', borderRadius: 7,
  padding: '3px 8px', fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 120,
  background: 'transparent', color: 'inherit',
}
const badge: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 999,
  background: 'var(--rd-accent-soft)', color: 'var(--rd-accent)',
  textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
}

const governRow: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  borderTop: '1px dashed var(--rd-border)', paddingTop: 8,
}
const governLabel: React.CSSProperties = { fontSize: 10.5, color: 'var(--rd-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }
const governItems: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center' }
const limitField: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }
const checkText: React.CSSProperties = { whiteSpace: 'nowrap', color: 'var(--rd-muted)', fontSize: 12 }
const miniInput: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 6,
  padding: '3px 8px', fontSize: 12, background: 'transparent', color: 'inherit', width: 72,
}

const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }

const issuesBox: React.CSSProperties = {
  border: '1px solid color-mix(in srgb, var(--rd-error) 35%, transparent)',
  borderRadius: 8,
  padding: '6px 10px',
  display: 'flex', flexDirection: 'column', gap: 2,
  background: 'color-mix(in srgb, var(--rd-error) 6%, transparent)',
}
const issueLine: React.CSSProperties = { fontSize: 12, color: 'var(--rd-error)', lineHeight: 1.5 }

const emptyHero: React.CSSProperties = {
  border: '1px dashed var(--rd-border)', borderRadius: 12,
  padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
}

const chipOption: React.CSSProperties = {
  ...chipStyle('var(--rd-muted)'),
  cursor: 'pointer', background: 'transparent', fontWeight: 500, fontSize: 12,
  padding: '4px 12px', gap: 6, color: 'inherit',
}
const chipSelected: React.CSSProperties = {
  ...chipOption,
  color: 'var(--rd-accent)', borderColor: 'var(--rd-accent)', fontWeight: 600,
  background: 'var(--rd-accent-soft)',
}

const stickyBar: React.CSSProperties = {
  position: 'sticky', bottom: 0, zIndex: 5,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
  marginTop: 4, padding: '10px 2px',
  background: 'var(--rd-surface)',
  borderTop: '1px solid var(--rd-border)',
}
const footerStatusStyle: React.CSSProperties = { fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }

// Sub-tab bar (same underline vocabulary as the semantic preview/editor tabs)
const subTabs: React.CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid var(--rd-border)', marginTop: -4 }
const subTab: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--rd-muted)', cursor: 'pointer',
  fontSize: 12.5, padding: '7px 14px', borderBottom: '2px solid transparent',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
const subTabActive: React.CSSProperties = { ...subTab, color: 'var(--rd-accent)', borderBottomColor: 'var(--rd-accent)', fontWeight: 600 }
const tabCount: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '0 6px', borderRadius: 999,
  background: 'var(--rd-accent-soft)', color: 'var(--rd-accent)', lineHeight: '16px',
}
const tabWarn: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '0 6px', borderRadius: 999,
  background: 'color-mix(in srgb, var(--rd-error) 12%, transparent)', color: 'var(--rd-error)', lineHeight: '16px',
}
