/**
 * Datasource connectivity probe.
 *
 * Reuses the already-constructed provider's own connection (the exact pool /
 * HTTP client / driver the real queries use) so the probe can never drift
 * from the live query path. A trivial `SELECT 1` is enough to confirm the
 * engine is reachable and authenticated; anything the driver throws
 * (DNS, auth, TLS, timeout) surfaces as an offline status with the message.
 *
 * @module dsh-rd-data-analysis/datasources/probe
 */

import type { DataSourceProvider } from '../types.ts'
import type { HealthStatus } from '../health.ts'

/** Probe timeout passed to the provider; kept short so the UI stays snappy. */
const PROBE_TIMEOUT_MS = 8_000

/**
 * Run a lightweight connectivity check against one provider.
 * @param provider - a live (or freshly built) datasource provider.
 * @param timeoutMs - statement timeout in ms (clamped for the probe).
 * @returns the connectivity status — never throws.
 */
export async function probeProvider(provider: DataSourceProvider, timeoutMs: number): Promise<HealthStatus> {
  const at = Date.now()
  try {
    await provider.query('SELECT 1', { timeoutMs: Math.min(Math.max(100, timeoutMs), PROBE_TIMEOUT_MS), maxRows: 1 })
    return { online: true, message: '', at }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { online: false, message, at }
  }
}
