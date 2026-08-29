/**
 * 数据库工作台 settings card (browser half): live connection management for
 * the `rd-data-analysis` settings namespace.
 *
 * Edits stage locally; 保存 writes `dataSources` (+ `semanticFile`) through
 * the bound settings scope — the Host hot-swaps providers and rewires the
 * semantic layer without a restart. Passwords are write-only (the schema
 * marks them secret, so stored values never echo back; a blank field keeps
 * the stored one).
 *
 * NOTE on reactivity: the store snapshot's section object must not be synced
 * during render (an unstable identity would loop React); subscription lives in
 * an effect and the form stages once when the section first arrives. 重置
 * re-stages from the store.
 *
 * @module dsh-rd-data-analysis/client/settings-card
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientKey } from '../i18n/client.ts'
import { rdVars, tokensFor } from './theme.ts'
import { SemanticSection } from './semantic-section.tsx'
import type { HealthStatus } from '../health.ts'
import type { SemanticSummary, SemanticConfig } from '../semantic/types.ts'

/** The namespace fields this card edits (subset of the plugin config). */
export interface WorkbenchSection {
  dataSources?: {
    name: string
    type: 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark'
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
  type: 'sqlite' | 'mysql' | 'postgres' | 'clickhouse' | 'spark'
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
}

const TYPES: Row['type'][] = ['sqlite', 'mysql', 'postgres', 'clickhouse', 'spark']

function emptyRow(): Row {
  return { name: '', type: 'mysql', file: '', host: '', port: '', user: '', password: '', database: '', approvalMode: 'auto', maxRows: '', timeoutMs: '', ssl: false, sparkMock: true }
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
        ...(row.type === 'sqlite'
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
        ...(row.type === 'spark' ? { sparkMock: row.sparkMock } : {}),
      }
    })
}

const DEFAULT_FIELDS: (keyof NonNullable<WorkbenchSection>)[] = [
  'defaultMaxRows', 'defaultTimeoutMs', 'modelRowCap', 'chartDataCap', 'schemaCacheTtlMs', 'exportDir',
]

/** Extract the editable global-defaults as string form fields. */
function toDefaults(section: WorkbenchSection | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of DEFAULT_FIELDS) {
    const value = (section as Record<string, unknown> | undefined)?.[key]
    out[key] = value !== undefined ? String(value) : ''
  }
  return out
}

/** Merge string defaults back into numeric/string config fields (drop blanks). */
function fromDefaults(defaults: Record<string, string>, current: WorkbenchSection | undefined): Partial<WorkbenchSection> {
  const out: Record<string, string | number | undefined> = {}
  for (const key of DEFAULT_FIELDS) {
    const raw = defaults[key] ?? ''
    if (raw.trim() === '') continue
    const numeric = Number(raw)
    out[key] = key === 'exportDir' ? raw : (Number.isFinite(numeric) ? numeric : undefined)
  }
  return out as Partial<WorkbenchSection>
}

export function DataWorkbenchCard({ scope, t }: { scope: SettingsScope<WorkbenchSection>; t: (key: ClientKey, params?: Record<string, unknown>) => string }): ReactNode {
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

  // Live connectivity status: read from the snapshot every render (the
  // subscription bumps `rev`, so the card re-renders when health arrives).
  const health = (scope.getSnapshot().value?.health ?? {}) as Record<string, HealthStatus>
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

  const restage = (): void => {
    const snapshot = scope.getSnapshot()
    setRows(toRows(snapshot.value))
    setSemanticFile(snapshot.value?.semanticFile ?? '')
    setDefaultDatasource(snapshot.value?.defaultDatasource ?? '')
    setDefaults(toDefaults(snapshot.value))
    setDirty(false)
    setSaveState('idle')
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

  const save = async (): Promise<void> => {
    setSaveState('saving')
    setError('')
    try {
      const next = fromRows(rows)
      const names = new Set(next.map((row) => row.name))
      if (names.size !== next.length) throw new Error(t('settings.duplicateName'))
      for (const row of next) {
        if (row.type === 'sqlite' && (row.file === undefined || row.file === '')) throw new Error(t('settings.sqliteFileRequired', { name: row.name }))
        if (row.type !== 'sqlite' && row.type !== 'spark' && (row.host === '' || row.database === '')) throw new Error(t('settings.remoteHostRequired', { name: row.name, type: row.type }))
      }
      await scope.set('dataSources', JSON.parse(JSON.stringify(next)))
      if (semanticFile !== (scope.getSnapshot().value?.semanticFile ?? '')) {
        await scope.set('semanticFile', semanticFile)
      }
      if (defaultDatasource !== (scope.getSnapshot().value?.defaultDatasource ?? '')) {
        await scope.set('defaultDatasource', defaultDatasource)
      }
      const defaultPatch = fromDefaults(defaults, scope.getSnapshot().value)
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

  if (status === 'unavailable') {
    return (
      <div style={{ ...root, ...vars }}>
        <div style={title}>{t('settings.title')}</div>
        <div style={muted}>{t('settings.unavailable')}</div>
      </div>
    )
  }
  if (status === 'loading') {
    return <div style={{ ...root, ...vars }}><div style={title}>{t('settings.title')}</div><div style={muted}>{t('settings.loading')}</div></div>
  }

  return (
    <div style={{ ...root, ...vars }}>
      <div style={headerRow}>
        <div>
          <div style={title}>{t('settings.title')}</div>
          <div style={muted} dangerouslySetInnerHTML={{ __html: t('settings.subtitle') }} />
        </div>
        <div style={headerActions}>
          <button type="button" style={actionButton} onClick={() => { setDirty(true); setSaveState('idle'); setRows((current) => [...current, emptyRow()]) }}>{t('settings.addConnection')}</button>
          <button type="button" style={{ ...actionButton, ...(dirty ? saveEnabled : {}) }} disabled={!dirty || saveState === 'saving'} onClick={() => { void save() }}>
            {saveState === 'saving' ? t('settings.saving') : t('settings.save')}
          </button>
          <button type="button" style={actionButton} onClick={restage}>{t('settings.reset')}</button>
        </div>
      </div>

      {saveState === 'saved' && <div style={markBanner(savedMark)}>{t('settings.saved')}</div>}
      {saveState === 'error' && <div style={markBanner(errorMark)}>{error}</div>}

      {/* 数据连接卡片 */}
      {rows.length === 0 && (
        <div style={emptyBox}>
          <div style={muted}><b>{t('settings.emptyTitle')}</b></div>
          <div style={muted}>{t('settings.emptyHint')}</div>
        </div>
      )}
      <div style={cards}>
        {rows.map((row, index) => (
          <div key={index} style={card}>
            <div style={cardHeader}>
              <div style={cardTitleRow}>
                <input style={nameInput} value={row.name} placeholder={t('settings.namePlaceholder')} onChange={(event) => update({ name: event.target.value }, index)} />
                <span style={badge}>{row.type}</span>
                <StatusChip status={health[row.name]} pending={pending[row.name] !== undefined} t={t} />
              </div>
              <div style={cardHeaderActions}>
                <button type="button" style={testButton} disabled={row.name.trim() === '' || pending[row.name] !== undefined} onClick={() => testConnection(row.name)}>{t('settings.testConnection')}</button>
                <button type="button" style={delButton} onClick={() => { setDirty(true); setSaveState('idle'); setRows((current) => current.filter((_, i) => i !== index)) }}>{t('settings.delete')}</button>
              </div>
            </div>

            <div style={grid}>
              <div style={field}>
                <div style={label}>{t('settings.type')}</div>
                <select style={input} value={row.type} onChange={(event) => update({ type: event.target.value as Row['type'] }, index)}>
                  {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>

              <div style={{ ...field, flex: '2 1 220px' }}>
                <div style={label}>{t(row.type === 'sqlite' ? 'settings.fileOrHost.sqlite' : 'settings.fileOrHost.remote')}</div>
                <input style={input} value={row.type === 'sqlite' ? row.file : row.host} placeholder={row.type === 'sqlite' ? t('settings.filePlaceholder') : t('settings.hostPlaceholder')} onChange={(event) => update(row.type === 'sqlite' ? { file: event.target.value } : { host: event.target.value }, index)} />
              </div>

              {row.type !== 'sqlite' && (
                <>
                  <div style={field}>
                    <div style={label}>{t('settings.port')}</div>
                    <input style={input} value={row.port} placeholder={t(`settings.defaultPort.${row.type}` as ClientKey)} onChange={(event) => update({ port: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>{t('settings.database')}</div>
                    <input style={input} value={row.database} placeholder="database" onChange={(event) => update({ database: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>{t('settings.user')}</div>
                    <input style={input} value={row.user} placeholder="user" onChange={(event) => update({ user: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>{t('settings.password')}</div>
                    <input style={input} type="password" value={row.password} placeholder={t('settings.passwordPlaceholder')} onChange={(event) => update({ password: event.target.value }, index)} />
                  </div>
                </>
              )}
            </div>

            <div style={toggles}>
              <label style={checkItem}>
                <input type="checkbox" checked={row.approvalMode === 'ask'} onChange={(event) => update({ approvalMode: event.target.checked ? 'ask' : 'auto' }, index)} />
                <span style={checkText}>{t('settings.approvalAsk')}</span>
              </label>
              {row.type === 'sqlite' ? (
                <span style={mutedFine}>{t('settings.sqliteNoApproval')}</span>
              ) : row.type === 'spark' ? (
                <label style={checkItem}>
                  <input type="checkbox" checked={row.sparkMock} onChange={(event) => update({ sparkMock: event.target.checked }, index)} />
                  <span style={checkText}>{t('settings.mock')}</span>
                </label>
              ) : (
                <label style={checkItem}>
                  <input type="checkbox" checked={row.ssl} onChange={(event) => update({ ssl: event.target.checked }, index)} />
                  <span style={checkText}>{t('settings.ssl')}</span>
                </label>
              )}

              <div style={limitGroup}>
                <label style={checkItem}>
                  <span style={checkText}>{t('settings.rowLimit')}</span>
                  <input style={miniInput} value={row.maxRows} placeholder={t('settings.fallback')} onChange={(event) => update({ maxRows: event.target.value }, index)} />
                </label>
                <label style={checkItem}>
                  <span style={checkText}>{t('settings.timeoutMs')}</span>
                  <input style={miniInput} value={row.timeoutMs} placeholder={t('settings.fallback')} onChange={(event) => update({ timeoutMs: event.target.value }, index)} />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 默认数据源 */}
      <div style={section}>
        <div style={sectionTitle}>{t('settings.defaultSource')}</div>
        <div style={muted}>{t('settings.defaultSourceHint')}</div>
        <div style={toolbar}>
          <select style={{ ...input, width: 200 }} value={defaultDatasource} onChange={(event) => { setDirty(true); setSaveState('idle'); setDefaultDatasource(event.target.value) }}>
            <option value="">{t('settings.defaultSourceAuto')}</option>
            {rows.filter((row) => row.name.trim() !== '').map((row) => (
              <option key={row.name} value={row.name}>{row.name} ({row.type})</option>
            ))}
          </select>
        </div>
      </div>

      {/* 外观主题：自动跟随系统 light/dark，不提供手动配置 */}
      <div style={section}>
        <div style={sectionTitle}>{t('settings.theme')}</div>
        <div style={muted}>{t('settings.themeHint')}</div>
      </div>

      {/* 全局默认 */}
      <div style={section}>
        <div style={sectionTitle}>{t('settings.globalDefaults')}</div>
        <div style={muted}>{t('settings.globalDefaultsHint')}</div>
        <div style={toolbar}>
          <label style={checkItem}><span style={checkText}>{t('settings.rowLimit')}</span><input style={miniInput} value={defaults.defaultMaxRows ?? ''} placeholder="500" onChange={setDefault('defaultMaxRows')} /></label>
          <label style={checkItem}><span style={checkText}>{t('settings.timeoutMs')}</span><input style={miniInput} value={defaults.defaultTimeoutMs ?? ''} placeholder="20000" onChange={setDefault('defaultTimeoutMs')} /></label>
          <label style={checkItem}><span style={checkText}>{t('settings.modelRowCap')}</span><input style={miniInput} value={defaults.modelRowCap ?? ''} placeholder="50" onChange={setDefault('modelRowCap')} /></label>
          <label style={checkItem}><span style={checkText}>{t('settings.chartDataCap')}</span><input style={miniInput} value={defaults.chartDataCap ?? ''} placeholder="500" onChange={setDefault('chartDataCap')} /></label>
          <label style={checkItem}><span style={checkText}>{t('settings.schemaCacheLabel')}</span><input style={miniInput} value={defaults.schemaCacheTtlMs ?? ''} placeholder="300000" onChange={setDefault('schemaCacheTtlMs')} /></label>
          <label style={{ ...checkItem, flex: '2 1 220px' }}><span style={checkText}>{t('settings.exportDirLabel')}</span><input style={input} value={defaults.exportDir ?? ''} placeholder="~/Downloads/dsh-exports" onChange={setDefault('exportDir')} /></label>
        </div>
      </div>

      {/* 语义层：路径 + 预览 + 编辑 + 生成 */}
      <SemanticSection
        scope={scope}
        t={t}
        semanticFile={semanticFile}
        setSemanticFile={(value) => { setDirty(true); setSaveState('idle'); setSemanticFile(value) }}
        datasourceNames={rows.filter((row) => row.name.trim() !== '').map((row) => row.name)}
      />
    </div>
  )
}

function defaultPort(type: Row['type']): string {
  switch (type) {
    case 'mysql': return '3306'
    case 'postgres': return '5432'
    case 'clickhouse': return '8123'
    default: return ''
  }
}

/** Connectivity status chip: testing / online / offline / not-tested. */
function StatusChip({ status, pending, t }: { status: HealthStatus | undefined, pending: boolean, t: (key: ClientKey, params?: Record<string, unknown>) => string }): ReactNode {
  if (pending) return <span style={statusChip('var(--rd-accent)')} title={t('settings.testing')}>● {t('settings.testing')}</span>
  if (status?.online === true) return <span style={statusChip('var(--rd-success)')} title={t('settings.online')}>● {t('settings.online')}</span>
  if (status?.online === false) return <span style={statusChip('var(--rd-error)')} title={status.message ?? t('settings.offline')}>● {t('settings.offline')}</span>
  return <span style={statusChip('var(--rd-muted)')} title={t('settings.notTested')}>○ {t('settings.notTested')}</span>
}

const root: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, color: 'var(--rd-text)' }
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }
const headerActions: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' }
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 2 }
const muted: React.CSSProperties = { color: 'var(--rd-muted)', lineHeight: 1.5 }
const mutedFine: React.CSSProperties = { ...muted, fontSize: 11 }

const cards: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const card: React.CSSProperties = {
  border: '1px solid var(--rd-border)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'var(--rd-surface)',
  display: 'flex', flexDirection: 'column', gap: 10,
}
const cardHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }
const cardTitleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }
const cardHeaderActions: React.CSSProperties = { display: 'flex', alignItems: 'center' }
const nameInput: React.CSSProperties = {
  border: '1px solid transparent', borderRadius: 6,
  padding: '3px 6px', fontSize: 13, fontWeight: 600, width: 180,
  background: 'transparent', color: 'inherit',
}
const badge: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 999,
  background: 'var(--rd-accent-soft)', color: 'var(--rd-accent)',
  textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
}
const grid: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 12px' }
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 150px', minWidth: 120 }
const label: React.CSSProperties = { fontSize: 11, color: 'var(--rd-muted)' }
const toggles: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center',
  borderTop: '1px dashed var(--rd-border)', paddingTop: 8,
}
const limitGroup: React.CSSProperties = { display: 'flex', gap: 16, flexWrap: 'wrap' }
const checkItem: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'inherit' }
const checkText: React.CSSProperties = { whiteSpace: 'nowrap', color: 'var(--rd-muted)' }

const section: React.CSSProperties = {
  border: '1px solid var(--rd-border)', borderRadius: 10,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }

const input: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 6,
  padding: '4px 8px', fontSize: 12, background: 'transparent', color: 'inherit', width: 140,
}
const miniInput: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 6,
  padding: '3px 6px', fontSize: 12, background: 'transparent', color: 'inherit', width: 64,
}
const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }
const actionButton: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 999,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '4px 12px',
}
const testButton: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 999,
  background: 'transparent', color: 'var(--rd-accent)', cursor: 'pointer', fontSize: 12, padding: '4px 10px',
}
const statusChip = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
  color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
  background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
  borderRadius: 999, padding: '1px 8px',
})
const saveEnabled: React.CSSProperties = {
  borderColor: 'var(--rd-accent)', color: 'var(--rd-accent)', fontWeight: 600,
}
const delButton: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--rd-muted)', cursor: 'pointer', fontSize: 12,
  padding: '2px 8px', borderRadius: 6,
}
const savedMark = 'var(--rd-success)'
const errorMark = 'var(--rd-error)'
const markBanner = (color: string): React.CSSProperties => ({
  fontSize: 12, color, padding: '6px 10px', borderRadius: 8,
  background: 'color-mix(in srgb, ' + color + ' 8%, transparent)',
})
const emptyBox: React.CSSProperties = {
  border: '1px dashed var(--rd-border)', borderRadius: 10,
  padding: '16px', display: 'flex', flexDirection: 'column', gap: 2,
}
