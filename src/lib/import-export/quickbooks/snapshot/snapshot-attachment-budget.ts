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

const numericEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

/** Total project-wide File Storage quota (Free plan = 1 GB decimal). */
export const STORAGE_QUOTA_BYTES = numericEnv('QB_SNAPSHOT_STORAGE_QUOTA_BYTES', 1_000_000_000)

/** Reserved head-room never available to attachment capture. */
export const RESERVED_SAFETY_BYTES = numericEnv('QB_SNAPSHOT_STORAGE_RESERVED_BYTES', 170_000_000)

export interface AttachmentBudgetInputs {
  quotaBytes: number
  currentUsageBytes: number
  reservedSafetyBytes: number
}

/** Deterministic: `max(0, quota - usage - reserve)`. */
export function computeAttachmentBudget(input: AttachmentBudgetInputs): number {
  const budget = input.quotaBytes - input.currentUsageBytes - input.reservedSafetyBytes
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
