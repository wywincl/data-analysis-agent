/**
 * Shared UI primitives for the Database Workbench (browser half).
 *
 * The workbench styles everything with inline style objects (the host page
 * provides the `--rd-*` token vocabulary). Pseudo-classes — hover, focus,
 * checked switch states — cannot be expressed inline, so `WorkbenchStyles`
 * injects one scoped stylesheet keyed on the `rdwb` root class; both the
 * settings card and the semantic section render inside that root.
 *
 * @module dsh-data-analysis/client/workbench-ui
 */

import type { ReactNode } from 'react'

/** Root className both workbench sections must carry for the stylesheet to scope. */
export const WB_ROOT = 'rdwb'

/**
 * One scoped stylesheet for all pseudo-class polish. Render once inside each
 * workbench root (dedup handled by React rendering it twice harmlessly, but
 * the card renders it exactly once at its root).
 */
export function WorkbenchStyles(): ReactNode {
  return <style>{CSS}</style>
}

const CSS = `
.rdwb { font-size: 13px; }
.rdwb button { font-family: inherit; transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, opacity .15s ease; }
.rdwb button:disabled { cursor: not-allowed; opacity: .5; }
.rdwb input, .rdwb select, .rdwb textarea { font-family: inherit; transition: border-color .15s ease, box-shadow .15s ease; }
.rdwb input:focus-visible, .rdwb select:focus-visible, .rdwb textarea:focus-visible {
  outline: none;
  border-color: var(--rd-accent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rd-accent) 22%, transparent);
}
.rdwb .rdwb-input-error { border-color: var(--rd-error) !important; }
.rdwb .rdwb-input-error:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--rd-error) 22%, transparent); }
.rdwb .rdwb-btn-primary:hover:not(:disabled) { background: var(--rd-accent); color: #fff; }
.rdwb .rdwb-btn-ghost:hover:not(:disabled) { border-color: var(--rd-accent); color: var(--rd-accent); }
.rdwb .rdwb-btn-danger-ghost:hover:not(:disabled) { border-color: var(--rd-error); color: var(--rd-error); }
.rdwb .rdwb-clickable { cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.rdwb .rdwb-clickable:hover { border-color: color-mix(in srgb, var(--rd-accent) 55%, var(--rd-border)); box-shadow: 0 1px 8px rgba(0,0,0,.07); }
.rdwb .rdwb-chip-opt { cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease; }
.rdwb .rdwb-chip-opt:hover { border-color: var(--rd-accent); color: var(--rd-accent); }
.rdwb .rdwb-add { transition: border-color .15s ease, background .15s ease; }
.rdwb .rdwb-add:hover { border-color: var(--rd-accent); background: color-mix(in srgb, var(--rd-accent) 8%, transparent); }
.rdwb .rdwb-name-input:hover:not(:focus) { border-color: var(--rd-control-border); }

/* Pill switch: a real checkbox stays in the tree for a11y/keyboard. */
.rdwb .rdwb-sw { position: relative; display: inline-flex; align-items: center; flex: none; }
.rdwb .rdwb-sw > input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.rdwb .rdwb-sw-track { display: block; width: 30px; height: 17px; border-radius: 999px; background: var(--rd-control-border); transition: background .18s ease; pointer-events: none; position: relative; }
.rdwb .rdwb-sw-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .18s ease; }
.rdwb .rdwb-sw > input:checked + .rdwb-sw-track { background: var(--rd-accent); }
.rdwb .rdwb-sw > input:checked + .rdwb-sw-track::after { transform: translateX(13px); }
.rdwb .rdwb-sw > input:focus-visible + .rdwb-sw-track { box-shadow: 0 0 0 2px color-mix(in srgb, var(--rd-accent) 30%, transparent); }
`

// --- shared inline styles -------------------------------------------------

/** Filled primary action (save / generate). */
export const btnPrimary: React.CSSProperties = {
  border: '1px solid var(--rd-accent)', borderRadius: 8,
  background: 'var(--rd-accent-soft)', color: 'var(--rd-accent)',
  cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 14px', lineHeight: 1.2,
}
/** Bordered ghost action (reset / secondary). */
export const btnGhost: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 8,
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5, padding: '6px 14px', lineHeight: 1.2,
}
/** Danger ghost (delete / confirm states recolor via props). */
export const btnDangerGhost: React.CSSProperties = {
  border: '1px solid transparent', borderRadius: 8,
  background: 'transparent', color: 'var(--rd-muted)', cursor: 'pointer', fontSize: 12, padding: '4px 10px', lineHeight: 1.2,
}

/** Standard form control filling its grid cell. */
export const inputFull: React.CSSProperties = {
  border: '1px solid var(--rd-control-border)', borderRadius: 7,
  padding: '6px 10px', fontSize: 12.5, background: 'transparent', color: 'inherit',
  width: '100%', boxSizing: 'border-box',
}

/** A labeled form field: label above the control, optional error line below. */
export function Field({ label, error, children, span }: {
  label?: string
  error?: string
  children: ReactNode
  /** When true the field spans the full grid row. */
  span?: boolean
}): ReactNode {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      {label !== undefined && label !== '' && (
        <span style={{ fontSize: 11, color: 'var(--rd-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      )}
      {children}
      {error !== undefined && error !== '' && (
        <span style={{ fontSize: 11, color: 'var(--rd-error)', lineHeight: 1.4 }}>⚠ {error}</span>
      )}
    </label>
  )
}

/** Error class for inputs under a failed validation. */
export const inputErrorClass = 'rdwb-input-error'

/** Accessible pill switch with a visible label. */
export function Switch({ checked, onChange, label, hint }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}): ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12 }} title={hint}>
      <span className="rdwb-sw">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
        <span className="rdwb-sw-track" />
      </span>
      <span style={{ color: checked ? 'inherit' : 'var(--rd-muted)', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  )
}

/** Responsive field grid — cells are `Field`s. */
export const fieldGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '10px 12px',
}

/** Card container used by both sections. */
export const cardBox: React.CSSProperties = {
  border: '1px solid var(--rd-border)', borderRadius: 12,
  padding: '12px 14px', background: 'var(--rd-surface)',
  display: 'flex', flexDirection: 'column', gap: 10,
}

/** Small chip/tag. */
export const chipStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
  color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
  background: `color-mix(in srgb, ${color} 12%, transparent)`,
  borderRadius: 999, padding: '1px 8px',
})
