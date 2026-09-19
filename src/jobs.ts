/**
 * Async query job store.
 *
 * Long / large queries should not block the model turn. `run_query_async`
 * starts a job against a {@link DataSourceProvider}, returns a `jobId`
 * immediately, and the job runs in the background (honoring an internal
 * `AbortController` for cancellation). `get_result_rows` pages the stored
 * result so big Spark / warehouse result sets never travel through the
 * conversation in one shot.
 *
 * The store is provider-agnostic: a job is just `provider.query(sql)` wrapped
 * with status tracking, TTL eviction, and a bounded size. A serialized
 * `QueryJob` carries no rows (those live in the separate `results` map keyed
 * by the same jobId) so status polling stays cheap.
 *
 * @module dsh-data-analysis/jobs
 */

import type { ColumnInfo, DataSourceProvider, QueryOptions, QueryResult } from './types.ts'

/** Lifecycle of an async query. */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Cheap, rows-free view of a job (returned by status polling + listing). */
export interface QueryJob {
  readonly jobId: string
  readonly datasource: string
  readonly sql: string
  readonly status: JobStatus
  readonly createdAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly rowCount?: number
  readonly truncated?: boolean
  /** Tables the statement touched (from the guard), for the audit trail. */
  readonly tablesTouched?: readonly string[]
  /** Why the query was run — snapshotted at submission for the audit trail. */
  readonly reason?: string
  /** Role at submission time (the settle callback must not read it live). */
  readonly role?: string
  /** Present only when the job failed and was not cancelled. */
  readonly error?: string
}

export interface JobPage {
  readonly jobId: string
  readonly status: JobStatus
  readonly columns: readonly ColumnInfo[]
  readonly rows: readonly Record<string, unknown>[]
  readonly total: number
  readonly offset: number
  readonly limit: number
}

/**
 * In-memory store of async query jobs. Bounded by `size` (oldest evicted) and
 * `ttlMs` (stale entries dropped on access). A job that outlives the TTL is
 * reported as unknown, mirroring the `resultId` behavior elsewhere.
 */
export class JobStore {
  private readonly jobs = new Map<string, QueryJob>()
  private readonly results = new Map<string, QueryResult>()
  private readonly controllers = new Map<string, AbortController>()
  /** Set by close() — in-flight runs must not write back or re-emit. */
  private closed = false

  constructor(
    private readonly ttlMs: number,
    private readonly size: number,
    /** Optional sink invoked exactly once when a job reaches a terminal state. */
    private readonly onSettle?: (job: QueryJob) => void,
  ) {}

  /**
   * Submit a query for background execution. Returns the freshly-created job
   * (status `pending`, then `running`) immediately; the query itself runs
   * asynchronously and its outcome updates the stored job.
   */
  start(jobId: string, provider: DataSourceProvider, sql: string, options: QueryOptions, tablesTouched?: readonly string[], submission?: { reason?: string, role?: string }): QueryJob {
    const job: QueryJob = {
      jobId,
      datasource: provider.name,
      sql,
      status: 'pending',
      createdAt: Date.now(),
      ...(tablesTouched !== undefined ? { tablesTouched } : {}),
      ...(submission?.reason !== undefined ? { reason: submission.reason } : {}),
      ...(submission?.role !== undefined ? { role: submission.role } : {}),
    }
    this.evict()
    this.jobs.set(jobId, job)
    void this.run(job, provider, options)
    return job
  }

  private async run(seed: QueryJob, provider: DataSourceProvider, options: QueryOptions): Promise<void> {
    // A cancel() may have landed before we flipped to running.
    if (this.closed || this.jobs.get(seed.jobId)?.status === 'cancelled') return
    const controller = new AbortController()
    this.controllers.set(seed.jobId, controller)
    const job: QueryJob = { ...seed, status: 'running', startedAt: Date.now() }
    this.jobs.set(seed.jobId, job)
    try {
      const result = await provider.query(seed.sql, { ...options, signal: controller.signal })
      // Evicted or closed while in flight: the store deliberately forgot this
      // job — writing it back would resurrect it past the size bound and
      // re-run the settlement callback after close(). A cancel() that landed
      // during the await also wins: never overwrite it with succeeded.
      const tracked = this.jobs.get(seed.jobId)
      if (this.closed || tracked === undefined || tracked.status === 'cancelled') return
      this.results.set(seed.jobId, result)
      const settled: QueryJob = { ...job, status: 'succeeded', finishedAt: Date.now(), rowCount: result.rowCount, truncated: result.truncated }
      this.jobs.set(seed.jobId, settled)
      this.onSettle?.(settled)
    } catch (error) {
      // Same guards: forgotten jobs stay forgotten; cancelled stays cancelled
      // rather than being overwritten with a failure.
      const tracked = this.jobs.get(seed.jobId)
      if (this.closed || tracked === undefined || tracked.status === 'cancelled') return
      const settled: QueryJob = {
        ...job,
        status: 'failed',
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }
      this.jobs.set(seed.jobId, settled)
      this.onSettle?.(settled)
    } finally {
      this.controllers.delete(seed.jobId)
    }
  }

  /** Request cancellation of a running/pending job. Returns false if not cancellable. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (job === undefined) return false
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return false
    const settled: QueryJob = { ...job, status: 'cancelled', finishedAt: Date.now() }
    this.jobs.set(jobId, settled)
    this.controllers.get(jobId)?.abort()
    this.controllers.delete(jobId)
    this.onSettle?.(settled)
    return true
  }

  /** Look up a job; returns undefined if unknown or past its TTL. */
  get(jobId: string): QueryJob | undefined {
    const job = this.jobs.get(jobId)
    if (job === undefined) return undefined
    if (Date.now() - job.createdAt > this.ttlMs) {
      this.drop(jobId, job)
      return undefined
    }
    return job
  }

  /** Page the rows of a succeeded job (undefined until then / if unknown). */
  rows(jobId: string, offset: number, limit: number): JobPage | undefined {
    const job = this.get(jobId)
    if (job === undefined || job.status !== 'succeeded') return undefined
    const result = this.results.get(jobId)
    if (result === undefined) return undefined
    const off = Math.max(0, Math.floor(offset))
    const lim = Math.max(1, Math.min(limit, 10_000))
    return {
      jobId,
      status: job.status,
      columns: result.columns,
      rows: result.rows.slice(off, off + lim),
      total: result.rowCount,
      offset: off,
      limit: lim,
    }
  }

  /** All non-expired jobs, newest first. */
  list(): QueryJob[] {
    return [...this.jobs.values()]
      .filter((job) => Date.now() - job.createdAt <= this.ttlMs)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Forget a job. An in-flight one is aborted and reported cancelled to the
   * settlement sink (so its audit record is not lost to eviction).
   */
  private drop(jobId: string, job: QueryJob): void {
    this.jobs.delete(jobId)
    this.results.delete(jobId)
    const controller = this.controllers.get(jobId)
    if (controller === undefined) return
    controller.abort()
    this.controllers.delete(jobId)
    if (job.status === 'pending' || job.status === 'running') {
      this.onSettle?.({ ...job, status: 'cancelled', finishedAt: Date.now() })
    }
  }

  private evict(): void {
    for (const [id, job] of this.jobs) {
      if (Date.now() - job.createdAt > this.ttlMs) this.drop(id, job)
    }
    while (this.jobs.size >= this.size) {
      const oldest = this.jobs.keys().next().value
      if (oldest === undefined) break
      const job = this.jobs.get(oldest)
      if (job !== undefined) this.drop(oldest, job)
      else this.jobs.delete(oldest)
    }
  }

  /** Abort every in-flight job and clear the store (plugin unload). */
  async close(): Promise<void> {
    this.closed = true
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    // Jobs that never reached a terminal state would otherwise vanish from
    // the audit trail — they are exactly the long/heavy ones worth recording.
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'running') {
        this.onSettle?.({ ...job, status: 'cancelled', finishedAt: Date.now() })
      }
    }
    this.jobs.clear()
    this.results.clear()
  }
}
