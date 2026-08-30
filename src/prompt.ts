/**
 * System-prompt section teaching the model the analysis workflow and the
 * guardrails (order 100–199 is the tool-guidance band).
 *
 * @module dsh-research/prompt
 */

import type { Config } from './config.ts'
import { zh, en, type HostLocale } from './i18n/host.ts'
import { tpl } from './i18n/index.ts'

function localeOf(config: Config): HostLocale {
  return config.locale === 'en' ? 'en' : 'zh'
}

export function workflowSectionText(config: Config): string {
  const locale = localeOf(config)
  const s = locale === 'zh' ? zh : en
  const sources = config.dataSources.map((ds) => `- ${ds.name} (${ds.type}${ds.sparkMock === true ? ', mock' : ''})`).join('\n') || '- (none configured)'
  const defaultNote = config.defaultDatasource !== ''
    ? `\n${locale === 'zh' ? '默认数据源' : 'Default datasource'}: **${config.defaultDatasource}** — ${locale === 'zh' ? '用户未指明来源时，优先查询' : 'when the user does not name a source, query'} "${config.defaultDatasource}".`
    : ''

  return tpl(s['workflow.title'], {}) + '\n\n' +
    tpl(s['workflow.connectedTo'], { sources, defaultNote }) + '\n\n' +
    s['workflow.discipline'] + '\n' +
    '1. ' + s['workflow.step1'] + '\n' +
    '2. ' + s['workflow.step2'] + '\n' +
    '3. ' + s['workflow.step3'] + '\n' +
    s['workflow.asyncNote'] + '\n' +
    '4. ' + s['workflow.step4'] + '\n' +
    '5. ' + s['workflow.step5'] + '\n' +
    '6. ' + s['workflow.step6'] + '\n\n' +
    s['workflow.qualityRules']
}

export function semanticDigestPrefix(config: Config): string {
  const locale = localeOf(config)
  const s = locale === 'zh' ? zh : en
  return tpl(s['semantic.digestPrefix'], { semanticFileHint: config.semanticFile !== '' ? config.semanticFile : (locale === 'zh' ? 'enable semanticFile in the workbench card' : 'enable semanticFile in the workbench card') })
}

export function semanticSectionTitle(config: Config): string {
  const locale = localeOf(config)
  const s = locale === 'zh' ? zh : en
  return s['semantic.sectionTitle']
}
