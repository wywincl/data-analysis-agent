/**
 * Client colour-token tests.
 *
 * Guards the regression that motivated `src/client/theme.ts`: the card styles
 * used to reference `--dsw-surface` / `--dsw-border` / `--dsw-muted` /
 * `--dsw-accent` / `--dsw-code-bg` / `--dsw-card-bg` / `--dsw-accent-soft`,
 * none of which the host defines — every one silently resolved to its light
 * fallback, so the workbench stayed white in dark mode (white card, near-white
 * text). Only `--dsw-alias-*` and `--dsw-static-*` are real.
 */
import { describe, expect, it } from 'vitest'
import { HOST_TOKENS, LIGHT_TOKENS, DARK_TOKENS, tokensFor, rdVars, type RdTokens } from '../src/client/theme.ts'

const ALL: Record<string, RdTokens> = { host: HOST_TOKENS, light: LIGHT_TOKENS, dark: DARK_TOKENS }

/** Variable names the host actually defines (checked against ui-theme). */
const REAL_PREFIXES = ['var(--dsw-alias-', 'var(--dsw-static-']

describe('client theme tokens', () => {
  it('reference only host-defined variables (or literal colours)', () => {
    for (const [name, tokens] of Object.entries(ALL)) {
      for (const [key, value] of Object.entries(tokens)) {
        const isVar = value.startsWith('var(')
        const isReal = REAL_PREFIXES.some((prefix) => value.startsWith(prefix))
        // `text: 'inherit'` is a legitimate value for the host-following set.
        const isLiteral = value === 'inherit' || value.startsWith('rgba(') || value.startsWith('rgb(') || value.startsWith('#')
        expect(isVar ? isReal : isLiteral, `${name}.${key} resolves to a host-defined token: ${value}`).toBe(true)
      }
    }
  })

  it('never reference the legacy bare names that the host does not define', () => {
    const legacy = ['--dsw-surface', '--dsw-border', '--dsw-muted', '--dsw-accent', '--dsw-code-bg', '--dsw-card-bg', '--dsw-accent-soft']
    for (const [name, tokens] of Object.entries(ALL)) {
      for (const value of Object.values(tokens)) {
        for (const bad of legacy) {
          expect(value.includes(bad), `${name} must not reference ${bad}: ${value}`).toBe(false)
        }
      }
    }
  })

  it('pinned palettes do not follow the host appearance', () => {
    // An explicit dark/light must not read `--dsw-alias-*`: the alias scale
    // flips with the host, which would defeat the override.
    for (const [name, tokens] of Object.entries({ light: LIGHT_TOKENS, dark: DARK_TOKENS })) {
      for (const [key, value] of Object.entries(tokens)) {
        expect(value.includes('--dsw-alias-'), `${name}.${key} must be pinned, got ${value}`).toBe(false)
      }
    }
  })

  it('light and dark palettes differ on every appearance-driven colour', () => {
    // `success` is intentionally identical (the host uses green-500 in both
    // appearances); everything that carries the light/dark identity must flip.
    const appearanceDriven: Array<keyof RdTokens> = ['surface', 'border', 'text', 'muted', 'accent', 'accentSoft', 'codeBg', 'controlBorder']
    for (const key of appearanceDriven) {
      expect(LIGHT_TOKENS[key], `${key} must differ between appearances`).not.toBe(DARK_TOKENS[key])
    }
  })

  it('tokensFor maps auto and unknown values to the host-following set', () => {
    expect(tokensFor('auto')).toBe(HOST_TOKENS)
    expect(tokensFor(undefined)).toBe(HOST_TOKENS)
    expect(tokensFor('')).toBe(HOST_TOKENS)
    expect(tokensFor('nonsense')).toBe(HOST_TOKENS)
    expect(tokensFor('dark')).toBe(DARK_TOKENS)
    expect(tokensFor('light')).toBe(LIGHT_TOKENS)
  })

  it('rdVars exposes every token as an --rd-* custom property', () => {
    const vars = rdVars(DARK_TOKENS) as Record<string, string>
    const expected: Record<string, string> = {
      '--rd-surface': DARK_TOKENS.surface,
      '--rd-border': DARK_TOKENS.border,
      '--rd-text': DARK_TOKENS.text,
      '--rd-muted': DARK_TOKENS.muted,
      '--rd-accent': DARK_TOKENS.accent,
      '--rd-accent-soft': DARK_TOKENS.accentSoft,
      '--rd-code-bg': DARK_TOKENS.codeBg,
      '--rd-success': DARK_TOKENS.success,
      '--rd-error': DARK_TOKENS.error,
      '--rd-control-border': DARK_TOKENS.controlBorder,
    }
    expect(vars).toEqual(expected)
  })
})
