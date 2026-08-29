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

export function DataWorkbenchCard({ scope }: { scope: SettingsScope<WorkbenchSection> }): ReactNode {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [rows, setRows] = useState<Row[]>([])
  const [semanticFile, setSemanticFile] = useState('')
  const [defaultDatasource, setDefaultDatasource] = useState('')
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [staged, setStaged] = useState(false)

  // Subscription lives in an effect: store notifications bump a revision and
  // the staging effect below re-checks — never read the store during render.
  const [rev, setRev] = useState(0)
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
      if (names.size !== next.length) throw new Error('连接名称重复')
      for (const row of next) {
        if (row.type === 'sqlite' && (row.file === undefined || row.file === '')) throw new Error(`"${row.name}"(sqlite)需要 file 路径`)
        if (row.type !== 'sqlite' && row.type !== 'spark' && (row.host === '' || row.database === '')) throw new Error(`"${row.name}"(${row.type})需要 host 和 database`)
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
      <div style={root}>
        <div style={title}>数据库工作台</div>
        <div style={muted}>设置服务不可用(该部署未挂载 settings),请通过配置文件(cordis patch)管理连接。</div>
      </div>
    )
  }
  if (status === 'loading') {
    return <div style={root}><div style={title}>数据库工作台</div><div style={muted}>加载配置…</div></div>
  }

  return (
    <div style={root}>
      <div style={headerRow}>
        <div>
          <div style={title}>数据库工作台</div>
          <div style={muted}>连接修改保存后<b>立即热生效</b>(无需重启);密码留空表示保持不变。语义层 YAML 保存后自动热加载,亦可用 /data-reload 手动重载。</div>
        </div>
        <div style={headerActions}>
          <button type="button" style={actionButton} onClick={() => { setDirty(true); setSaveState('idle'); setRows((current) => [...current, emptyRow()]) }}>+ 添加连接</button>
          <button type="button" style={{ ...actionButton, ...(dirty ? saveEnabled : {}) }} disabled={!dirty || saveState === 'saving'} onClick={() => { void save() }}>
            {saveState === 'saving' ? '保存中…' : '保存(热生效)'}
          </button>
          <button type="button" style={actionButton} onClick={restage}>重置</button>
        </div>
      </div>

      {saveState === 'saved' && <div style={markBanner(savedMark)}>已保存并热生效 ✓</div>}
      {saveState === 'error' && <div style={markBanner(errorMark)}>{error}</div>}

      {/* 数据连接卡片 */}
      {rows.length === 0 && (
        <div style={emptyBox}>
          <div style={muted}><b>尚未配置任何数据源。</b></div>
          <div style={muted}>点击右上角「添加连接」新增;或通过配置文件(cordis patch)的 dataSources 管理。</div>
        </div>
      )}
      <div style={cards}>
        {rows.map((row, index) => (
          <div key={index} style={card}>
            <div style={cardHeader}>
              <div style={cardTitleRow}>
                <input style={nameInput} value={row.name} placeholder="连接名称(如 demo)" onChange={(event) => update({ name: event.target.value }, index)} />
                <span style={badge}>{row.type}</span>
              </div>
              <div style={cardHeaderActions}>
                <button type="button" style={delButton} onClick={() => { setDirty(true); setSaveState('idle'); setRows((current) => current.filter((_, i) => i !== index)) }}>删除</button>
              </div>
            </div>

            <div style={grid}>
              <div style={field}>
                <div style={label}>类型</div>
                <select style={input} value={row.type} onChange={(event) => update({ type: event.target.value as Row['type'] }, index)}>
                  {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>

              <div style={{ ...field, flex: '2 1 220px' }}>
                <div style={label}>{row.type === 'sqlite' ? '数据库文件' : '主机 Host'}</div>
                <input style={input} value={row.type === 'sqlite' ? row.file : row.host} placeholder={row.type === 'sqlite' ? '/path/demo.db' : 'host 或 http://host'} onChange={(event) => update(row.type === 'sqlite' ? { file: event.target.value } : { host: event.target.value }, index)} />
              </div>

              {row.type !== 'sqlite' && (
                <>
                  <div style={field}>
                    <div style={label}>端口</div>
                    <input style={input} value={row.port} placeholder={defaultPort(row.type)} onChange={(event) => update({ port: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>数据库</div>
                    <input style={input} value={row.database} placeholder="database" onChange={(event) => update({ database: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>用户</div>
                    <input style={input} value={row.user} placeholder="user" onChange={(event) => update({ user: event.target.value }, index)} />
                  </div>
                  <div style={field}>
                    <div style={label}>密码</div>
                    <input style={input} type="password" value={row.password} placeholder="留空不变" onChange={(event) => update({ password: event.target.value }, index)} />
                  </div>
                </>
              )}
            </div>

            <div style={toggles}>
              <label style={checkItem}>
                <input type="checkbox" checked={row.approvalMode === 'ask'} onChange={(event) => update({ approvalMode: event.target.checked ? 'ask' : 'auto' }, index)} />
                <span style={checkText}>写入前人工审批(ask)</span>
              </label>
              {row.type === 'sqlite' ? (
                <span style={mutedFine}>SQLite 无需审批</span>
              ) : row.type === 'spark' ? (
                <label style={checkItem}>
                  <input type="checkbox" checked={row.sparkMock} onChange={(event) => update({ sparkMock: event.target.checked }, index)} />
                  <span style={checkText}>使用内建 Mock 数据</span>
                </label>
              ) : (
                <label style={checkItem}>
                  <input type="checkbox" checked={row.ssl} onChange={(event) => update({ ssl: event.target.checked }, index)} />
                  <span style={checkText}>启用 TLS(SSL)</span>
                </label>
              )}

              <div style={limitGroup}>
                <label style={checkItem}>
                  <span style={checkText}>行上限</span>
                  <input style={miniInput} value={row.maxRows} placeholder="缺省" onChange={(event) => update({ maxRows: event.target.value }, index)} />
                </label>
                <label style={checkItem}>
                  <span style={checkText}>超时(ms)</span>
                  <input style={miniInput} value={row.timeoutMs} placeholder="缺省" onChange={(event) => update({ timeoutMs: event.target.value }, index)} />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 默认数据源 */}
      <div style={section}>
        <div style={sectionTitle}>默认数据源</div>
        <div style={muted}>用户提问未指明具体来源时,模型优先使用该数据源;选择「自动」则让模型自行判断。</div>
        <div style={toolbar}>
          <select style={{ ...input, width: 200 }} value={defaultDatasource} onChange={(event) => { setDirty(true); setSaveState('idle'); setDefaultDatasource(event.target.value) }}>
            <option value="">自动(由模型选择)</option>
            {rows.filter((row) => row.name.trim() !== '').map((row) => (
              <option key={row.name} value={row.name}>{row.name} ({row.type})</option>
            ))}
          </select>
        </div>
      </div>

      {/* 全局默认 */}
      <div style={section}>
        <div style={sectionTitle}>全局默认</div>
        <div style={muted}>留空使用内置默认;单连接字段覆盖这里的值。</div>
        <div style={toolbar}>
          <label style={checkItem}><span style={checkText}>行上限</span><input style={miniInput} value={defaults.defaultMaxRows ?? ''} placeholder="500" onChange={setDefault('defaultMaxRows')} /></label>
          <label style={checkItem}><span style={checkText}>超时(ms)</span><input style={miniInput} value={defaults.defaultTimeoutMs ?? ''} placeholder="20000" onChange={setDefault('defaultTimeoutMs')} /></label>
          <label style={checkItem}><span style={checkText}>模型可见行数</span><input style={miniInput} value={defaults.modelRowCap ?? ''} placeholder="50" onChange={setDefault('modelRowCap')} /></label>
          <label style={checkItem}><span style={checkText}>单图数据点</span><input style={miniInput} value={defaults.chartDataCap ?? ''} placeholder="500" onChange={setDefault('chartDataCap')} /></label>
          <label style={checkItem}><span style={checkText}>schema 缓存 TTL(ms)</span><input style={miniInput} value={defaults.schemaCacheTtlMs ?? ''} placeholder="300000" onChange={setDefault('schemaCacheTtlMs')} /></label>
          <label style={{ ...checkItem, flex: '2 1 220px' }}><span style={checkText}>仪表板导出目录</span><input style={input} value={defaults.exportDir ?? ''} placeholder="~/Downloads/dsh-exports" onChange={setDefault('exportDir')} /></label>
        </div>
      </div>

      {/* 语义层 */}
      <div style={section}>
        <div style={sectionTitle}>语义层</div>
        <div style={muted}>实体 / 术语 / 指标定义 YAML;保存后自动热加载,亦可用 /data-reload 手动重载。</div>
        <div style={toolbar}>
          <label style={{ ...checkItem, flex: '1 1 320px' }}><span style={checkText}>配置文件路径</span><input style={input} value={semanticFile} placeholder="语义层 YAML 绝对路径(可选)" onChange={(event) => { setDirty(true); setSaveState('idle'); setSemanticFile(event.target.value) }} /></label>
        </div>
      </div>
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

const root: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }
const headerActions: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' }
const title: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 2 }
const muteBase = 'var(--dsw-muted, #6b7280)'
const muted: React.CSSProperties = { color: muteBase, lineHeight: 1.5 }
const mutedFine: React.CSSProperties = { ...muted, fontSize: 11 }

const cards: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const card: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'var(--dsw-surface, #ffffff)',
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
  background: 'var(--dsw-accent-soft, #eef3ff)', color: 'var(--dsw-accent, #2f6feb)',
  textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
}
const grid: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 12px' }
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 150px', minWidth: 120 }
const label: React.CSSProperties = { fontSize: 11, color: muteBase }
const toggles: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center',
  borderTop: '1px dashed var(--dsw-border, #e5e7eb)', paddingTop: 8,
}
const limitGroup: React.CSSProperties = { display: 'flex', gap: 16, flexWrap: 'wrap' }
const checkItem: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'inherit' }
const checkText: React.CSSProperties = { whiteSpace: 'nowrap', color: muteBase }

const section: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 10,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }

const input: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 6,
  padding: '4px 8px', fontSize: 12, background: 'transparent', color: 'inherit', width: 140,
}
const miniInput: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 6,
  padding: '3px 6px', fontSize: 12, background: 'transparent', color: 'inherit', width: 64,
}
const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }
const actionButton: React.CSSProperties = {
  border: '1px solid var(--dsw-border, #e5e7eb)', borderRadius: 999,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '4px 12px',
}
const saveEnabled: React.CSSProperties = {
  borderColor: 'var(--dsw-accent, #2f6feb)', color: 'var(--dsw-accent, #2f6feb)', fontWeight: 600,
}
const delButton: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--dsw-muted, #6b7280)', cursor: 'pointer', fontSize: 12,
  padding: '2px 8px', borderRadius: 6,
}
const savedMark = '#12b76a'
const errorMark = '#e5484d'
const markBanner = (color: string): React.CSSProperties => ({
  fontSize: 12, color, padding: '6px 10px', borderRadius: 8,
  background: 'color-mix(in srgb, ' + color + ' 8%, transparent)',
})
const emptyBox: React.CSSProperties = {
  border: '1px dashed var(--dsw-border, #e5e7eb)', borderRadius: 10,
  padding: '16px', display: 'flex', flexDirection: 'column', gap: 2,
}
