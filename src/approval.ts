/**
 * Approval gate on the tool pipeline: sources configured `approvalMode: 'ask'`
 * require human confirmation (via the harness approval service) before
 * `run_sql` / `analyze_data` execute; `auto` sources pass straight through to
 * the guard + provider.
 *
 * Registered as a plain `tools/pre-execute` waterfall listener — the native
 * hook mechanism IS an ordinary Cordis event (extension cookbook). Listeners
 * MUST call `next()` to allow, or return a decision to short-circuit.
 *
 * @module dsh-research/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'

/** Tools that execute model-authored SQL. */
const SQL_TOOLS = new Set(['run_sql', 'analyze_data'])

export function registerApprovalGate(ctx: Context, config: Config): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!SQL_TOOLS.has(exec.name)) return next()
    const args = (exec.arguments ?? {}) as { datasource?: unknown }
    const datasource = typeof args.datasource === 'string' ? args.datasource : undefined
    if (datasource === undefined) return next() // tool itself reports the usage error

    const configured = config.dataSources.find((ds) => ds.name === datasource)
    if (configured === undefined) return next() // unknown source: tool reports available names

    if (configured.approvalMode === 'ask') {
      return { kind: 'ask', reason: `SQL execution on "${datasource}" requires approval (approvalMode: ask).` }
    }
    return next()
  })
}
