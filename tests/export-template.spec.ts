/**
 * Self-contained HTML export: model-authored strings (title, datasource,
 * timestamps, kpi unit) must never reach innerHTML unescaped — a prompt
 * injection inside a data value flows into these fields and the export file
 * typically travels by email/file share.
 *
 * Two defense layers, asserted separately:
 *  - STATIC: the payload travels as embedJson() output (< > & become
 *    \\u003c-style escapes inside the script tag), so no raw markup exists
 *    in the file at all.
 *  - RUNTIME: the browser script builds every card via esc() — asserted at
 *    source level so the escaping cannot silently regress.
 */
import { describe, expect, it } from 'vitest'
import { renderStandaloneHtml, toCsv } from '../src/shared/export-template.ts'

const injection = {
  title: 'Chart</h2><script>alert(1)</script>',
  datasource: '<img src=x onerror=alert(2)>',
  createdAt: '<svg onload=alert(3)>',
  echartsOption: { kpi: { value: 42, unit: '<b>px</b>' } },
  data: [],
  columns: [{ name: 'a', type: 'x' }],
} as const

function render(): string {
  return renderStandaloneHtml([{ ...injection }], { title: 'Dashboard', echartsUmd: '', locale: 'zh' })
}

describe('renderStandaloneHtml XSS: static artifact', () => {
  it('contains no raw model-authored markup anywhere', () => {
    const html = render()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<svg onload')
    expect(html).not.toContain('<b>px</b>')
  })

  it('embeds the payload as \\u003c-escaped JSON inside the script tag', () => {
    const html = render()
    expect(html).toContain('\\u003cscript\\u003e')
    expect(html).toContain('\\u003cimg src=x onerror=alert(2)\\u003e')
    expect(html).toContain('\\u003csvg onload=alert(3)\\u003e')
    expect(html).toContain('\\u003cb\\u003epx\\u003c/b\\u003e')
  })
})

describe('renderStandaloneHtml XSS: runtime sinks route through esc()', () => {
  it('escapes the chart title, metadata line, and kpi unit at DOM-construction time', () => {
    const html = render()
    expect(html).toContain('esc(chart.title)')
    expect(html).toContain('esc(chart.createdAt)')
    expect(html).toContain('esc(meta)')
    expect(html).toContain('esc(chart.option.kpi.unit)')
  })
})

describe('toCsv', () => {
  it('quotes cells containing separators/quotes/newlines (RFC-4180)', () => {
    const csv = toCsv([{ name: 'a' }, { name: 'b' }], [{ a: 'x,y', b: 'he said "hi"' }])
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"he said ""hi"""')
  })
})
