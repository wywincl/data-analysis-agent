/**
 * Connectivity health status shared by the host (which runs the probe) and
 * the settings card (which renders the online/offline indicator). Kept in its
 * own dependency-free module so the browser half can import the type without
 * pulling in server-only runtime imports.
 *
 * @module dsh-data-analysis/health
 */

/** Result of one connectivity probe for a datasource. */
export interface HealthStatus {
  /** True when the probe reached the engine and ran a trivial statement. */
  readonly online: boolean
  /**
   * Failure reason. Empty string when `online` is true; the schema requires a
   * string, so the probe always sets it (never undefined).
   */
  readonly message: string
  /** Epoch millis at which the probe completed (dedupes in-flight UI). */
  readonly at: number
}
