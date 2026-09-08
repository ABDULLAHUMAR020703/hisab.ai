import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  SnapshotAttachmentLedgerEntry,
  SnapshotAttachmentSummary,
} from './snapshot-model'

/**
 * Durable per-attachment capture ledger (`quickbooks_snapshot_attachments`).
 *
 * One row per QuickBooks Attachable considered for a snapshot. Replaces the
 * coarse { binariesDownloaded, binariesFailed } counters so the snapshot can
 * say exactly which attachments were CAPTURED, SKIPPED_BUDGET, FAILED or
 * UNAVAILABLE — and the snapshot-backed migration can resolve the captured
 * binary from Storage without calling QuickBooks.
 */

const TABLE = 'quickbooks_snapshot_attachments'

/**
 * Rows fetched per page. PostgREST caps a single response at its configured
 * `max-rows` (1000 by default), so the ledger MUST be paged — a snapshot can
 * have tens of thousands of Attachables.
 */
export const LEDGER_PAGE_SIZE = 1000
/** Refuse to build an absurdly large in-memory ledger (guards a pagination loop bug). */
const LEDGER_SANE_MAX = 5_000_000

function mapRow(row: Record<string, unknown>): SnapshotAttachmentLedgerEntry {
  return {
    attachableId: String(row.attachable_id),
    entityRef: (row.entity_ref ?? null) as SnapshotAttachmentLedgerEntry['entityRef'],
    fileName: row.file_name != null ? String(row.file_name) : null,
    contentType: row.content_type != null ? String(row.content_type) : null,
    sourceSize: row.source_size == null ? null : Number(row.source_size),
    storagePath: row.storage_path != null ? String(row.storage_path) : null,
    status: (row.status ?? 'pending') as SnapshotAttachmentLedgerEntry['status'],
    reason: row.reason != null ? String(row.reason) : null,
    capturedBytes: row.captured_bytes == null ? null : Number(row.captured_bytes),
    checksum: row.checksum != null ? String(row.checksum) : null,
  }
}

/** Exact row count for a snapshot's ledger (does not transfer any rows). */
export async function countAttachmentLedger(snapshotId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('snapshot_id', snapshotId)
  if (error) throw error
  return count ?? 0
}

/**
 * The COMPLETE attachment ledger for a snapshot.
 *
 * Deterministically paged by `attachable_id` until a short page is returned,
 * then cross-checked against `count: 'exact'` — a mismatch throws rather than
 * silently truncating. Duplicate ids across page boundaries are de-duplicated
 * defensively. Safe for tens of thousands of rows.
 */
export async function listAttachmentLedger(snapshotId: string): Promise<SnapshotAttachmentLedgerEntry[]> {
  const db = createAdminClient()
  const expected = await countAttachmentLedger(snapshotId)

  const out: SnapshotAttachmentLedgerEntry[] = []
  const seen = new Set<string>()
  for (let offset = 0; ; offset += LEDGER_PAGE_SIZE) {
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .eq('snapshot_id', snapshotId)
      .order('attachable_id', { ascending: true })
      .range(offset, offset + LEDGER_PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) {
      const id = String(row.attachable_id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(mapRow(row))
    }
    if (out.length > LEDGER_SANE_MAX) {
      throw new Error(`attachment ledger for ${snapshotId} exceeds the sane maximum (${out.length} rows)`)
    }
    if (rows.length < LEDGER_PAGE_SIZE) break
  }

  if (out.length !== expected) {
    throw new Error(
      `attachment ledger pagination anomaly for ${snapshotId}: count says ${expected} rows, retrieved ${out.length}`,
    )
  }
  return out
}

export async function upsertAttachmentLedgerEntry(
  snapshotId: string,
  companyId: string,
  entry: SnapshotAttachmentLedgerEntry,
): Promise<void> {
  const { error } = await createAdminClient()
    .from(TABLE)
    .upsert(
      {
        snapshot_id: snapshotId,
        company_id: companyId,
        attachable_id: entry.attachableId,
        entity_ref: entry.entityRef,
        file_name: entry.fileName,
        content_type: entry.contentType,
        source_size: entry.sourceSize,
        storage_path: entry.storagePath,
        status: entry.status,
        reason: entry.reason,
        captured_bytes: entry.capturedBytes,
        checksum: entry.checksum,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'snapshot_id,attachable_id' },
    )
  if (error) throw error
}

/** Sum of bytes durably captured so far (idempotent under retry / upsert). */
export function capturedBytesOf(entries: SnapshotAttachmentLedgerEntry[]): number {
  return entries
    .filter((e) => e.status === 'captured')
    .reduce((sum, e) => sum + (e.capturedBytes ?? 0), 0)
}

export function emptyAttachmentSummary(metadataRecords = 0): SnapshotAttachmentSummary {
  return {
    metadataRecords,
    binariesDownloaded: 0,
    binariesFailed: 0,
    totalCandidates: 0,
    captured: 0,
    skippedBudget: 0,
    failed: 0,
    unavailable: 0,
    capturedBytes: 0,
    coveragePercent: 100,
  }
}

/** Pure: fold the ledger into the manifest/checkpoint attachment summary. */
export function summariseAttachmentLedger(
  entries: SnapshotAttachmentLedgerEntry[],
  opts: { budgetBytes?: number; metadataRecords?: number } = {},
): SnapshotAttachmentSummary {
  const count = (status: SnapshotAttachmentLedgerEntry['status']) =>
    entries.filter((e) => e.status === status).length
  const captured = count('captured')
  const total = entries.length
  const capturedBytes = capturedBytesOf(entries)
  return {
    metadataRecords: opts.metadataRecords ?? total,
    binariesDownloaded: captured,
    binariesFailed: count('failed'),
    totalCandidates: total,
    captured,
    skippedBudget: count('skipped_budget'),
    failed: count('failed'),
    unavailable: count('unavailable'),
    capturedBytes,
    budgetBytes: opts.budgetBytes,
    coveragePercent: total ? Math.round((captured / total) * 1000) / 10 : 100,
  }
}

/** First AttachableRef → EntityRef, as { type, value }. */
export function firstAttachableEntityRef(
  raw: Record<string, unknown>,
): SnapshotAttachmentLedgerEntry['entityRef'] {
  const refs = Array.isArray(raw.AttachableRef) ? (raw.AttachableRef as Array<Record<string, unknown>>) : []
  for (const ref of refs) {
    const entityRef = ref?.EntityRef as Record<string, unknown> | undefined
    const value = entityRef?.value
    if (value != null && value !== '') {
      return { type: String(entityRef?.type ?? ''), value: String(value) }
    }
  }
  return null
}
