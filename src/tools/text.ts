/**
 * Shared model-facing text rendering helpers for tools and commands.
 *
 * @module dsh-rd-data-analysis/tools/text
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Compact text table for model-facing render (bounded). */
export function textTable(columns: readonly string[], rows: readonly Record<string, JsonValue>[], maxRows = 30): string {
  if (rows.length === 0) return '(no rows)'
  const header = columns.slice(0, 12).join(' | ')
  const lines = rows.slice(0, maxRows).map((row) =>
    columns.slice(0, 12).map((column) => {
      const value = row[column]
      return value === null || value === undefined ? '∅' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    }).join(' | '),
  )
  const note = rows.length > maxRows ? `\n… ${rows.length - maxRows} more rows in the full result (use analyze_data or render_chart instead of re-reading).` : ''
  return `${header}\n${'-'.repeat(Math.min(header.length, 120))}\n${lines.join('\n')}${note}`
}
