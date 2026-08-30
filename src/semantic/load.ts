/**
 * Semantic layer YAML loading.
 *
 * The layer used to be a single flat file. It is now a graph: a root file may
 * `include` other files, and definitions inherit down `defaults → entity →
 * extends → metric`. This module is the thin seam that turns a path into a
 * composed, linted config:
 *
 * ```
 * root file ──include.ts──▶ fragments ──compose.ts──▶ config + issues
 *                                                        └──lint.ts
 * ```
 *
 * Validation is hand-rolled (fail with the file path + the offending key)
 * rather than schema-lib based: the config is operator-authored, so errors
 * must be actionable. Structural faults throw {@link SemanticConfigError} and
 * the runtime keeps the last good config; semantic smells come back as
 * warnings and never block a load.
 *
 * @module dsh-data-analysis/semantic/load
 */

import { parse as parseYaml } from 'yaml'
import { SemanticConfigError } from './errors.ts'
import { composeSemantic } from './compose.ts'
import { loadFragments, loadInlineFragments, realFiles } from './include.ts'
import type { LintIssue, SemanticConfig } from './types.ts'

export { SemanticConfigError }

/** A loaded semantic layer: the composed config plus everything needed to run/watch it. */
export interface SemanticLoadResult {
  config: SemanticConfig
  /** Non-fatal health-check findings (warnings only). */
  issues: readonly LintIssue[]
  /** Root file plus every included file, in merge order — the watch set. */
  files: readonly string[]
}

export interface ParseSemanticOptions {
  /** Base directory for resolving `include` entries; defaults to the cwd. */
  dir?: string
  /** Label used in error messages instead of a file path. */
  label?: string
}

/**
 * Parse and validate a semantic YAML document.
 *
 * `include` entries resolve against `options.dir` (the file's own directory
 * when loading from disk), so this is the one entry point that works for both
 * file-backed and in-memory configs.
 */
export function parseSemanticConfig(source: string, options: ParseSemanticOptions = {}): SemanticConfig {
  let doc: unknown
  try {
    doc = parseYaml(source)
  } catch (error) {
    throw new SemanticConfigError(`semantic YAML parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return composeSemantic(loadInlineFragments(doc, options.dir, options.label ?? '<inline>')).config
}

/** Load the include graph rooted at `file` and compose it. */
export function loadSemanticGraph(file: string): SemanticLoadResult {
  const fragments = loadFragments(file)
  const { config, issues } = composeSemantic(fragments)
  return { config, issues, files: realFiles(fragments) }
}

/** Load and compose a semantic config file from disk (convenience wrapper). */
export function loadSemanticFile(file: string): SemanticConfig {
  return loadSemanticGraph(file).config
}
