/**
 * Storage-aware attachment budgeting for QuickBooks snapshots.
 *
 * Core accounting data is captured first and is never at risk. Attachment
 * binaries are then captured only while they fit inside an
 * application-enforced budget:
 *
 *   attachmentBudget = max(0, quota - currentProjectUsage - reservedSafety)
 *
 * `currentProjectUsage` is measured AFTER every non-attachment resource is
 * terminal, so it already includes this snapshot's core JSON + manifest and
 * every other bucket's data. Nothing is counted twice.
 *
 * The ceiling is enforced by us, never by provoking a Supabase quota rejection.
 */

export const DEFAULT_STORAGE_QUOTA_BYTES = 1_000_000_000 // Free plan, 1 GB decimal
export const DEFAULT_RESERVED_SAFETY_BYTES = 170_000_000

const parseIntEnv = (raw: string | undefined): number | null => {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && Number.isInteger(value) ? value : NaN
}

/** A quota override is honoured only when it is a positive integer. */
export function sanitizeQuotaBytes(raw: string | undefined, fallback = DEFAULT_STORAGE_QUOTA_BYTES): number {
  const value = parseIntEnv(raw)
  if (value === null) return fallback
  if (Number.isNaN(value) || value <= 0) {
    console.warn(`[quickbooks-snapshot] ignoring invalid QB_SNAPSHOT_STORAGE_QUOTA_BYTES=${JSON.stringify(raw)}; using ${fallback}`)
    return fallback
  }
  return value
}

/**
 * A reserve override is honoured only when it is a non-negative integer that is
 * STRICTLY smaller than the quota — so the safety buffer can never be
 * configured away.
 */
export function sanitizeReserveBytes(
  raw: string | undefined,
  quotaBytes: number,
  fallback = DEFAULT_RESERVED_SAFETY_BYTES,
): number {
  const value = parseIntEnv(raw)
  if (value === null) return Math.min(fallback, Math.max(0, quotaBytes - 1))
  if (Number.isNaN(value) || value < 0 || value >= quotaBytes) {
    console.warn(`[quickbooks-snapshot] ignoring invalid QB_SNAPSHOT_STORAGE_RESERVED_BYTES=${JSON.stringify(raw)}; using ${fallback}`)
    return Math.min(fallback, Math.max(0, quotaBytes - 1))
  }
  return value
}

/**
 * Total project-wide File Storage quota. Overridable via
 * QB_SNAPSHOT_STORAGE_QUOTA_BYTES for non-production tiers; a non-positive or
 * non-integer value is rejected in favour of the safe default.
 */
export const STORAGE_QUOTA_BYTES = sanitizeQuotaBytes(process.env.QB_SNAPSHOT_STORAGE_QUOTA_BYTES)

/** Reserved head-room never available to attachment capture. */
export const RESERVED_SAFETY_BYTES = sanitizeReserveBytes(
  process.env.QB_SNAPSHOT_STORAGE_RESERVED_BYTES,
  STORAGE_QUOTA_BYTES,
)

export interface AttachmentBudgetInputs {
  quotaBytes: number
  currentUsageBytes: number
  reservedSafetyBytes: number
}

/**
 * Deterministic budget: `max(0, quota - usage - reserve)`, and never more than
 * `quota - usage - reserve`. Defensive against a caller passing an unsafe
 * (non-positive quota, negative usage/reserve, reserve >= quota) combination —
 * any such case collapses the budget to 0 rather than producing an unsafe
 * figure.
 */
export function computeAttachmentBudget(input: AttachmentBudgetInputs): number {
  const quota = Number.isFinite(input.quotaBytes) ? input.quotaBytes : 0
  const usage = Number.isFinite(input.currentUsageBytes) ? Math.max(0, input.currentUsageBytes) : Number.POSITIVE_INFINITY
  const reserve = Number.isFinite(input.reservedSafetyBytes) ? Math.max(0, input.reservedSafetyBytes) : Number.POSITIVE_INFINITY
  if (quota <= 0 || reserve >= quota) return 0
  const budget = quota - usage - reserve
  return budget > 0 ? Math.floor(budget) : 0
}

/**
 * Does one more object of `sizeBytes` still fit? Inclusive of bytes already
 * captured in this snapshot's attachment phase.
 */
export function attachmentFitsBudget(input: {
  budgetBytes: number
  capturedBytes: number
  sizeBytes: number
}): boolean {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) return false
  return input.capturedBytes + input.sizeBytes <= input.budgetBytes
}
