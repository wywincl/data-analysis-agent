/**
 * Colour tokens for the client half of the plugin.
 *
 * The host (deepseek-harness) owns the design system: `ui-theme` defines a
 * `--dsw-alias-*` semantic scale on `body` and swaps it under
 * `body[data-ds-dark-theme]`. The legacy `--dsw-surface` / `--dsw-border` /
 * `--dsw-muted` / `--dsw-accent` names this plugin used to reference are
 * **defined nowhere in the host** — every one of them silently resolved to its
 * light-mode fallback, so the workbench stayed white-on-dark-mode.
 *
 * Two layers:
 *
 * 1. `HOST_TOKENS` — follow the host appearance. Used by the chat chart node
 *    (which has no per-plugin override) and by the workbench card when
 *    `theme` is `auto`.
 * 2. `LIGHT_TOKENS` / `DARK_TOKENS` — built from the theme-independent
 *    `--dsw-static-*` scale, so an explicit `theme: dark|light` can override
 *    the host appearance for the workbench card alone without hardcoding a
 *    second palette.
 *
 * Components consume these as `--rd-*` custom properties set on their root
 * element; the style constants below stay static objects.
 *
 * @module dsh-rd-data-analysis/client/theme
 */

import type { CSSProperties } from 'react'

/** Token values for one appearance. */
export interface RdTokens {
  readonly surface: string
  /** Border for card/section containers — the host's subtle `border-l1`. */
  readonly border: string
  /** Body text. Only the pinned palettes set it — `auto` inherits the host's. */
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly accentSoft: string
  readonly codeBg: string
  readonly success: string
  readonly error: string
  /** Border for form controls (input/select/button) — the host's `border-l2`. */
  readonly controlBorder: string
}

/** `auto`: inherit whatever the host resolved (system preference or its own setting). */
export const HOST_TOKENS: RdTokens = {
  // Match the settings panel surface (`bg-layer-2`) so nested cards blend in
  // like native dsh cards — not a darker recessed box on a lighter panel.
  surface: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  border: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))',
  text: 'inherit',
  muted: 'var(--dsw-alias-label-secondary, #6b7280)',
  accent: 'var(--dsw-alias-state-business-primary, #2f6feb)',
  accentSoft: 'var(--dsw-alias-state-business-tertiary, #eef3ff)',
  codeBg: 'var(--dsw-alias-markdown-code-block, #f3f4f6)',
  success: 'var(--dsw-alias-state-success-primary, #12b76a)',
  error: 'var(--dsw-alias-state-error-primary, #e5484d)',
  controlBorder: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
}

/**
 * `light`: pinned to the static scale. The statics carry the same values in
 * both appearances of `design-platform.css`, so referencing them pins the
 * palette regardless of the host theme.
 */
export const LIGHT_TOKENS: RdTokens = {
  surface: 'var(--dsw-static-neutral-bluish-00, #ffffff)',
  // Literal, not `var(--dsw-alias-*)`: the alias scale flips with the host
  // appearance, which would defeat a pinned palette.
  border: 'rgba(0, 0, 0, 0.04)',
  text: 'var(--dsw-static-neutral-bluish-1000, #0f1115)',
  muted: 'var(--dsw-static-neutral-bluish-700, #6b7280)',
  accent: 'var(--dsw-static-deepseek-500, #2f6feb)',
  accentSoft: 'var(--dsw-static-deepseek-100, #eef3ff)',
  codeBg: 'var(--dsw-static-neutral-bluish-50, #f3f4f6)',
  success: 'var(--dsw-static-green-500, #12b76a)',
  error: 'var(--dsw-static-red-600, #e5484d)',
  controlBorder: 'rgba(0, 0, 0, 0.1)',
}

/** `dark`: the dark side of the same static scale. */
export const DARK_TOKENS: RdTokens = {
  surface: 'var(--dsw-static-neutral-bluish-850, #2c2c2e)',
  border: 'rgba(255, 255, 255, 0.06)',
  text: 'var(--dsw-static-neutral-bluish-50, #f9fafb)',
  muted: 'var(--dsw-static-neutral-bluish-300, #cfd3d6)',
  accent: 'var(--dsw-static-deepseek-400, #679efe)',
  accentSoft: 'var(--dsw-static-deepseek-800, #34415b)',
  codeBg: 'var(--dsw-static-neutral-bluish-900, #1b1b1c)',
  success: 'var(--dsw-static-green-500, #12b76a)',
  error: 'var(--dsw-static-red-400, #f25a5a)',
  controlBorder: 'rgba(255, 255, 255, 0.12)',
}

/**
 * Pick the token set for a `theme` value. `auto` (and anything unrecognised)
 * follows the host appearance.
 * @param theme - configured appearance override.
 */
export function tokensFor(theme: string | undefined): RdTokens {
  if (theme === 'dark') return DARK_TOKENS
  if (theme === 'light') return LIGHT_TOKENS
  return HOST_TOKENS
}

/**
 * Spread onto a root element so descendant `var(--rd-*)` references resolve to
 * `tokens`. Keys are custom properties, hence the cast.
 * @param tokens - resolved token set.
 */
export function rdVars(tokens: RdTokens): CSSProperties {
  return {
    '--rd-surface': tokens.surface,
    '--rd-border': tokens.border,
    '--rd-text': tokens.text,
    '--rd-muted': tokens.muted,
    '--rd-accent': tokens.accent,
    '--rd-accent-soft': tokens.accentSoft,
    '--rd-code-bg': tokens.codeBg,
    '--rd-success': tokens.success,
    '--rd-error': tokens.error,
    '--rd-control-border': tokens.controlBorder,
  } as CSSProperties
}
