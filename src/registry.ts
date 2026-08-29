/**
 * Datasource registry + session-scoped caches.
 *
 * Holds the mounted {@link DataSourceProvider}s, the schema introspection
 * cache (TTL), the recent-result store that lets `render_chart` reference a
 * `run_sql` result by id without the model re-echoing rows, and the
 * per-session chart log backing `/export`.
 *
 * @module dsh-research/registry
 */

import type { QueryResult, SchemaInfo } from './types.ts'

/** One cached executed query (full rows, server-side only). */
export interface CachedResult {
  readonly resultId: string
  readonly datasource: string
  readonly dialect: string
  readonly sql: string
  readonly columns: QueryResult['columns']
  /** Full rows up to the per-source hard cap (NOT the model-visible slice). */
  readonly rows: readonly Record<string, unknown>[]
  readonly rowCount: number
  readonly truncated: boolean
  readonly at: number
}

interface CacheEntry<T> { readonly value: T, readonly at: number }

export class DataSourceRegistry {
  private readonly providers = new Map<string, import('./types.ts').DataSourceProvider>()
  private readonly schemas = new Map<string, CacheEntry<SchemaInfo>>()
  private readonly results = new Map<string, CacheEntry<CachedResult>>()

  constructor(
    private readonly schemaTtlMs: number,
    private readonly resultTtlMs: number,
    private readonly resultCacheSize: number,
  ) {}

  register(provider: import('./types.ts').DataSourceProvider): () => void {
    if (this.providers.has(provider.name)) {
      throw new Error(`rd-data-analysis: datasource "${provider.name}" registered twice`)
    }
    this.providers.set(provider.name, provider)
    return () => { this.providers.delete(provider.name) }
  }

  /** Forget every registered provider (hot re-wire; callers close them first). */
  dropAll(): void {
    this.providers.clear()
    this.schemas.clear()
  }

  get(name: string): import('./types.ts').DataSourceProvider | undefined {
    return this.providers.get(name)
  }

  list(): { name: string, type: string, dialect: string, mock: boolean }[] {
    return [...this.providers.values()].map((provider) => ({
      name: provider.name, type: provider.type, dialect: provider.dialect, mock: provider.mock ?? false,
    }))
  }

  /** Introspected schema with TTL cache; pass `refresh` to invalidate. */
  async schema(name: string, options: { readonly includeSamples?: boolean, readonly refresh?: boolean, readonly signal?: AbortSignal } = {}): Promise<SchemaInfo> {
    if (options.refresh !== true) {
      const cached = this.schemas.get(name)
      if (cached !== undefined && Date.now() - cached.at < this.schemaTtlMs) return cached.value
    }
    const provider = this.get(name)
    if (provider === undefined) throw new Error(`Unknown datasource "${name}".`)
    const schema = await provider.introspect(options)
    this.schemas.set(name, { value: schema, at: Date.now() })
    return schema
  }

  /** Store one executed query for render_chart references (bounded, TTL). */
  putResult(result: Omit<CachedResult, 'at'>): void {
    const key = result.resultId
    // Evict oldest entries beyond the size bound (Map preserves insertion order).
    while (this.results.size >= this.resultCacheSize) {
      const oldest = this.results.keys().next().value
      if (oldest === undefined) break
      this.results.delete(oldest)
    }
    this.results.set(key, { value: { ...result, at: Date.now() }, at: Date.now() })
  }

  getResult(resultId: string): CachedResult | undefined {
    const entry = this.results.get(resultId)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at > this.resultTtlMs) {
      this.results.delete(resultId)
      return undefined
    }
    return entry.value
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.providers.values()].map((provider) => provider.close()))
    this.providers.clear()
  }
}
