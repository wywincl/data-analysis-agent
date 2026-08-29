/**
 * i18n index: shared types and host-side translate helper.
 *
 * @module dsh-rd-data-analysis/i18n
 */

export type { HostLocale, HostStrings } from './host.ts'
export { zh as hostZh, en as hostEn } from './host.ts'

export type { ClientLocale, ClientKey } from './client.ts'
export { zh as clientZh, en as clientEn } from './client.ts'

/** Parameter map for host-side template strings. */
export interface HostParams {
  [key: string]: string | number | boolean | undefined
}

/** Simple template interpolation: replace {key} with params[key]. */
export function tpl(template: string, params?: HostParams): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = params[key]
    return value !== undefined ? String(value) : _match
  })
}
