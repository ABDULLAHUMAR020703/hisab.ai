import 'server-only'
import {
  QuickBooksImportAdapter,
  RESOURCES,
  filterResourceRows,
} from '@/lib/import-export/sources/quickbooks.adapter'
import { dependencyOrderedRows } from '@/lib/import-export/import/import-processor'
import type { MappedRow } from '@/lib/import-export/types'
import type { SourceResourcePage } from '@/lib/import-export/sources/source-registry'
import { logger } from '@/lib/ops/logger'
import { parseSnapshotPageFileName } from './snapshot-model'
import { buildSnapshotManifest, readSnapshotManifest } from './snapshot-manifest'
import { getSnapshot, getReadCursor, upsertReadCursor } from './snapshot.service'
import { listAttachmentLedger } from './snapshot-attachment-ledger'
import { readRawPage } from './snapshot-storage'

/**
 * Records consumed from a snapshot Storage page file per worker invocation.
 * A page file holds up to `PAGE_SIZE` (1000) raw records, but each migration
 * step must stay a bounded unit of work — so the reader hands the importer at
 * most this many records at a time and only advances the Storage page cursor
 * once the whole page file has been consumed. Kept equal to the `batchSize`
 * the import route passes for snapshot-backed jobs.
 */
export const SNAPSHOT_MIGRATION_WINDOW = 100

/**
 * Reads one bounded window (<= {@link SNAPSHOT_MIGRATION_WINDOW} records) from a
 * COMPLETE Supabase Storage snapshot and returns it in the same shape the live
 * QuickBooks page fetch uses, so the import route consumes it unchanged.
 * QuickBooks is never called here.
 *
 * A `(nextPage, pageOffset)` cursor tracks position: `nextPage` is the 1-based
 * index into the resource's ordered Storage page files, `pageOffset` how many
 * records of that page file earlier windows already consumed. The reader only
 * advances `nextPage` (and resets `pageOffset` to 0) once a page file is fully
 * read, so a 481-record page file is consumed as five windows
 * (0-99, 100-199, 200-299, 300-399, 400-480) before the next page file — every
 * record exactly once.
 *
 * The raw records are run through the SAME `adapter.normalizeRecords(...)` +
 * `filterResourceRows(...)` the live adapter applies, and `accounts` get the
 * same parent-before-child ordering, applied across the WHOLE page file before
 * it is sliced into windows.
 */
export async function fetchSnapshotResourcePage(input: {
  companyId: string
  snapshotId: string
  resourceKey: string
  importJobId: string
}): Promise<SourceResourcePage> {
  const { companyId, snapshotId, resourceKey, importJobId } = input

  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`QuickBooks snapshot ${snapshotId} not found for company ${companyId}.`)
  // COMPLETE must also mean validated — defends against a COMPLETE row left
  // without a validation report by an interrupted finalize.
  if (snapshot.status !== 'COMPLETE' || !snapshot.validation?.ok) {
    throw new Error(`QuickBooks snapshot is not complete.`)
  }

  const manifest =
    (await readSnapshotManifest(snapshot.storagePrefix)) ?? (await buildSnapshotManifest(snapshot))
  const summary = manifest.entities[resourceKey]

  // Ordered distinct page numbers -> the part files that make up each page.
  const pageParts = new Map<number, string[]>()
  for (const file of summary?.files ?? []) {
    const parsed = parseSnapshotPageFileName(file.split('/').slice(1).join('/'))
    if (!parsed) continue
    const parts = pageParts.get(parsed.page) ?? []
    parts.push(file)
    pageParts.set(parsed.page, parts)
  }
  const pageNumbers = [...pageParts.keys()].sort((a, b) => a - b)
  const totalPages = pageNumbers.length

  const stored = await getReadCursor(importJobId, resourceKey)
  const cursor =
    stored ??
    { importJobId, companyId, snapshotId, resourceKey, nextPage: 1, pageOffset: 0, recordsRead: 0, exhausted: false }

  const resourceMeta = RESOURCES.find((r) => r.key === resourceKey) ?? {
    key: resourceKey,
    label: resourceKey,
    moduleKey: resourceKey,
  }

  // Nothing (more) to read: unsupported resource, empty resource, or exhausted.
  if (cursor.exhausted || cursor.nextPage > totalPages || totalPages === 0) {
    await upsertReadCursor({ ...cursor, pageOffset: 0, exhausted: true })
    return emptyPage(resourceMeta, cursor.recordsRead)
  }

  // Read + normalize the WHOLE current page file (bounded: <= PAGE_SIZE records
  // / <= MAX_PAGE_BYTES), then slice the window. Re-reading the same immutable
  // page file across a resource's windows is deterministic, so every record is
  // yielded exactly once.
  const pageNumber = pageNumbers[cursor.nextPage - 1]
  const files = (pageParts.get(pageNumber) ?? []).sort()
  const rawRecords: unknown[] = []
  for (const file of files) {
    rawRecords.push(...(await readRawPage(snapshot.storagePrefix, file)))
  }

  const adapter = new QuickBooksImportAdapter()
  const filteredRaw = filterResourceRows(resourceKey, rawRecords)
  let normalizedRows = adapter.normalizeRecords(resourceKey, filteredRaw, snapshot.realmId)

  // Attachments: resolve each captured binary from the snapshot's own Storage
  // prefix (zero-copy — same `quickbooks-migration` bucket the live import
  // writes to). `_hisabAttachment` is the exact shape `materializeAttachment`
  // consumes. QuickBooks is never called. Skipped / failed attachments get no
  // `_hisabAttachment`, so `materializeAttachment` returns null for them.
  // Built over the FULL page arrays (index-aligned with `filteredRaw`) before
  // the window slice below.
  if (resourceKey === 'attachments') {
    const captured = new Map(
      (await listAttachmentLedger(snapshotId))
        .filter((entry) => entry.status === 'captured' && entry.storagePath)
        .map((entry) => [entry.attachableId, entry]),
    )
    if (captured.size) {
      filteredRaw.forEach((raw, index) => {
        const id = String((raw as Record<string, unknown>)?.Id ?? '')
        const entry = id ? captured.get(id) : undefined
        const row = normalizedRows[index]
        if (entry && row) {
          row._hisabAttachment = JSON.stringify({
            storagePath: `${snapshot.storagePrefix}/${entry.storagePath}`,
            fileName: entry.fileName ?? `quickbooks-${id}`,
            mimeType: entry.contentType ?? 'application/octet-stream',
          })
        }
      })
    }
  }

  // Parent-before-child ordering for `accounts`, applied across the WHOLE page
  // file so a child never lands in an earlier window than its parent. Identity
  // for every other resource.
  if (resourceKey === 'accounts') {
    normalizedRows = dependencyOrderedRows(
      'accounts',
      normalizedRows.map<MappedRow>((mapped, index) => ({ rowNumber: index + 1, source: mapped, mapped })),
    ).map((row) => row.mapped as (typeof normalizedRows)[number])
  }

  const pageRecordCount = normalizedRows.length
  const offset = Math.min(Math.max(0, cursor.pageOffset), pageRecordCount)
  const windowRows = normalizedRows.slice(offset, offset + SNAPSHOT_MIGRATION_WINDOW)

  const pageFullyRead = offset + windowRows.length >= pageRecordCount
  const morePages = cursor.nextPage < totalPages
  const hasMore = !pageFullyRead || morePages

  const recordsRead = cursor.recordsRead + windowRows.length
  const nextPage = pageFullyRead ? cursor.nextPage + 1 : cursor.nextPage
  const nextPageOffset = pageFullyRead ? 0 : offset + windowRows.length
  const nextExhausted = pageFullyRead && nextPage > totalPages

  logger.info('quickbooks.snapshot.migration.page', {
    snapshotId,
    resource: resourceKey,
    importJobId,
    page: cursor.nextPage,
    totalPages,
    pageOffset: offset,
    pageRecordCount,
    windowRows: windowRows.length,
    recordsRead,
    hasMore,
  })

  return {
    resource: { ...resourceMeta, rows: windowRows, hasMore },
    hasMore,
    checkpoint: { startPosition: cursor.nextPage, fetched: recordsRead },
    commit: async () => {
      await upsertReadCursor({
        importJobId,
        companyId,
        snapshotId,
        resourceKey,
        nextPage,
        pageOffset: nextPageOffset,
        recordsRead,
        exhausted: nextExhausted,
      })
    },
  }
}

function emptyPage(
  resourceMeta: { key: string; label: string; moduleKey: string },
  fetched: number,
): SourceResourcePage {
  return {
    resource: { ...resourceMeta, rows: [], hasMore: false },
    hasMore: false,
    checkpoint: { startPosition: 1, fetched },
    commit: async () => {},
  }
}
