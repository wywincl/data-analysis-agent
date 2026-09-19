/**
 * Approval gate on the tool pipeline: sources configured `approvalMode: 'ask'`
 * require human confirmation (via the harness approval service) before any
 * SQL executes on them; `auto` sources pass straight through to the guard +
 * provider.
 *
 * The gate keys on **where SQL will actually run**, not on a tool-name
 * whitelist: `run_sql` / `analyze_data` / `run_query_async` always execute
 * model-authored SQL, `render_chart` does only when it carries a fresh `sql`
 * (the `resultId` / inline-data paths reuse an already-approved result or run
 * no SQL at all), and `query_metric` executes against the metric's resolved
 * datasource.
 *
 * Registered as a plain `tools/pre-execute` waterfall listener — the native
 * hook mechanism IS an ordinary Cordis event (extension cookbook). Listeners
 * MUST call `next()` to allow, or return a decision to short-circuit.
 *
 * @module dsh-data-analysis/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import type { SemanticLayer } from './semantic/layer.ts'

/** Tools that always execute model-authored SQL on `args.datasource`. */
const ALWAYS_SQL_TOOLS = new Set(['run_sql', 'analyze_data', 'run_query_async'])

/**
 * Normalize `exec.arguments`: hosts may hand over an object or a JSON string
 * (tool-call compatibility layers). An unrecognized shape must NOT silently
 * pass the gate (fail closed → let the tool itself report the usage error).
 */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
}

/**
 * Resolve the datasource this tool call will execute SQL against, or
 * `undefined` when it runs no SQL (or the target can't be resolved here —
 * the tool itself reports that error).
 */
function datasourceFor(name: string, args: Record<string, unknown>, semantic: SemanticLayer): string | undefined {
  const direct = typeof args.datasource === 'string' ? args.datasource : undefined
  if (ALWAYS_SQL_TOOLS.has(name)) return direct
  if (name === 'render_chart') {
    // Fresh SQL only; resultId / inline-data reuse already-approved results.
    return typeof args.sql === 'string' && args.sql.trim() !== '' ? direct : undefined
  }
  if (name === 'query_metric') {
    if (typeof args.metric !== 'string') return undefined
    try {
      return semantic.resolveMetric(args.metric).datasource
    } catch {
      return undefined // unknown metric / no datasource: the tool reports it
    }
  }
  return undefined
}

export function registerApprovalGate(ctx: Context, config: Config, semantic: SemanticLayer): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const args = parseArguments(exec.arguments)
    const datasource = datasourceFor(exec.name, args, semantic)
    if (datasource === undefined) return next()

    const configured = config.dataSources.find((ds) => ds.name === datasource)
    if (configured === undefined) return next() // unknown source: tool reports available names

    if (configured.approvalMode === 'ask') {
      return { kind: 'ask', reason: `SQL execution on "${datasource}" requires approval (approvalMode: ask).` }
    }
    return next()
  })
}
