/**
 * Semantic config error type. Lives in its own module so the include loader,
 * the composer and the loader can all throw it without importing each other
 * (load.ts → include.ts → errors.ts would otherwise be a cycle).
 *
 * @module dsh-rd-data-analysis/semantic/errors
 */

/** Raised for any structural problem in the semantic YAML (fail loudly, keep the last good config). */
export class SemanticConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticConfigError'
  }
}
