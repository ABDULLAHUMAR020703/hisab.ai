/**
 * Pure types + status helpers for the immutable QuickBooks raw snapshot.
 *
 * A snapshot is an object tree in the private `quickbooks-migration` Supabase
 * Storage bucket. These types describe the manifest / DB summary; nothing here
 * touches the network or the database.
 */

export const EXTRACTOR_VERSION = '2026-09-06-snapshot-v1'

export type SnapshotStatus = 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'FAILED'

/** Per-resource terminal + in-flight states. `unsupported` is distinct from `failed`. */
export type SnapshotEntityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unsupported'

export interface SnapshotPartitionWindow {
  start: string
  end: string
  records: number
}

export interface SnapshotEntitySummary {
  /** Adapter resource key, e.g. `invoices`. */
  resourceKey: string
  /** QuickBooks entity name, e.g. `Invoice`. */
  entity: string
  status: SnapshotEntityStatus
  /** `full` or `partitioned` (date-windowed transaction resources). */
  extractionMode: 'full' | 'partitioned'
  pages: number
  records: number
  /** Storage object paths (relative to the snapshot prefix). */
  files: string[]
  /** Completed date-partition windows, for boundary + duplicate validation. */
  partitions?: SnapshotPartitionWindow[]
  error?: string
  unsupportedReason?: string
  unsupportedStatus?: number
  /** Attachments only: metadata capture is independent of binary-download outcome. */
  attachmentSummary?: SnapshotAttachmentSummary
}

export interface SnapshotAttachmentSummary {
  metadataRecords: number
  /** Legacy alias for `captured` — kept so pre-070 snapshots stay readable. */
  binariesDownloaded: number
  /** Legacy alias for `failed`. */
  binariesFailed: number
  // Best-effort storage-budgeted capture (migration 070+). All optional so a
  // snapshot written before this feature still parses.
  totalCandidates?: number
  captured?: number
  skippedBudget?: number
  failed?: number
  unavailable?: number
  capturedBytes?: number
  budgetBytes?: number
  /** captured / totalCandidates, 0-100, rounded to 1 dp. */
  coveragePercent?: number
}

/** Per-attachment capture outcome (row of `quickbooks_snapshot_attachments`). */
export type SnapshotAttachmentCaptureStatus =
  | 'pending'
  | 'captured'
  | 'skipped_budget'
  | 'failed'
  | 'unavailable'

export interface SnapshotAttachmentLedgerEntry {
  attachableId: string
  entityRef: { type: string; value: string } | null
  fileName: string | null
  contentType: string | null
  /** QuickBooks-reported size in bytes; null/0 when QuickBooks omits it. */
  sourceSize: number | null
  /** Path relative to the snapshot prefix; set only when `status === 'captured'`. */
  storagePath: string | null
  status: SnapshotAttachmentCaptureStatus
  reason: string | null
  capturedBytes: number | null
  checksum: string | null
}

export interface SnapshotManifest {
  snapshotId: string
  companyId: string
  realmId: string
  status: SnapshotStatus
  storageBucket: string
  storagePrefix: string
  extractorVersion: string
  startedAt: string
  completedAt: string | null
  sourceCompany: Record<string, unknown> | null
  requiredResources: string[]
  requestedResources: string[]
  entities: Record<string, SnapshotEntitySummary>
  errors: string[]
  warnings: string[]
  validation?: SnapshotValidationReport
}

export interface SnapshotValidationIssue {
  resourceKey: string
  code:
    | 'not_terminal'
    | 'page_gap'
    | 'invalid_json'
    | 'count_mismatch'
    | 'duplicate_id'
    | 'partition_gap'
    | 'partition_overlap'
    | 'missing_file'
    | 'required_failed'
    | 'required_unsupported'
    | 'attachment_missing_object'
    | 'attachment_size_mismatch'
    | 'attachment_ledger_inconsistent'
  message: string
}

export interface SnapshotValidationReport {
  ok: boolean
  checkedAt: string
  issues: SnapshotValidationIssue[]
  resourceStatuses: Record<string, SnapshotEntityStatus>
}

const TERMINAL: ReadonlySet<SnapshotEntityStatus> = new Set(['completed', 'failed', 'unsupported'])

export function isTerminalEntityStatus(status: SnapshotEntityStatus): boolean {
  return TERMINAL.has(status)
}

/**
 * Overall snapshot status from the per-resource map.
 *
 * - RUNNING  — at least one required resource is not terminal yet.
 * - COMPLETE — every required resource is `completed` (never `unsupported`/`failed`).
 * - FAILED   — every required resource is terminal and none `completed`.
 * - PARTIAL  — every required resource is terminal, some `completed`, but at
 *              least one required resource is `failed` or `unsupported`.
 *
 * Optional resources never block COMPLETE, but a `failed` optional resource
 * still forces PARTIAL so the operator sees it.
 */
export function computeSnapshotStatus(
  entities: Record<string, Pick<SnapshotEntitySummary, 'status'>>,
  requiredResources: readonly string[],
): SnapshotStatus {
  const required = requiredResources.map((key) => entities[key]?.status ?? 'pending')
  if (required.some((status) => !isTerminalEntityStatus(status))) return 'RUNNING'

  const allValues = Object.values(entities).map((entity) => entity.status)
  if (allValues.some((status) => !isTerminalEntityStatus(status))) return 'RUNNING'

  const requiredCompleted = required.every((status) => status === 'completed')
  if (requiredCompleted) {
    const anyOptionalFailed = Object.entries(entities).some(
      ([key, entity]) => !requiredResources.includes(key) && entity.status === 'failed',
    )
    return anyOptionalFailed ? 'PARTIAL' : 'COMPLETE'
  }

  const anyRequiredCompleted = required.some((status) => status === 'completed')
  return anyRequiredCompleted ? 'PARTIAL' : 'FAILED'
}

export function isSnapshotConsumable(status: SnapshotStatus): boolean {
  return status === 'COMPLETE'
}

/** Zero-padded page file name, e.g. `page-000007.json` or `page-000007-part-02.json`. */
export function snapshotPageFileName(page: number, part?: number): string {
  const base = `page-${String(page).padStart(6, '0')}`
  return part && part > 1 ? `${base}-part-${String(part).padStart(2, '0')}.json` : `${base}.json`
}

/** Parses `page-000007[-part-02].json` back to `{ page, part }`; null when it does not match. */
export function parseSnapshotPageFileName(fileName: string): { page: number; part: number } | null {
  const match = /^page-(\d{6})(?:-part-(\d{2}))?\.json$/.exec(fileName)
  if (!match) return null
  return { page: Number(match[1]), part: match[2] ? Number(match[2]) : 1 }
}
