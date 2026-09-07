import 'server-only'
import {
  QuickBooksImportAdapter,
  RESOURCES,
  filterResourceRows,
} from '@/lib/import-export/sources/quickbooks.adapter'
import type { SourceResourcePage } from '@/lib/import-export/sources/source-registry'
import { logger } from '@/lib/ops/logger'
import { parseSnapshotPageFileName } from './snapshot-model'
import { buildSnapshotManifest, readSnapshotManifest } from './snapshot-manifest'
import { getSnapshot, getReadCursor, upsertReadCursor } from './snapshot.service'
import { listAttachmentLedger } from './snapshot-attachment-ledger'
import { readRawPage } from './snapshot-storage'

/**
 * Reads exactly one raw page from a COMPLETE Supabase Storage snapshot and
 * returns it in the same shape the live QuickBooks page fetch uses, so the
 * import route consumes it unchanged. QuickBooks is never called here.
 *
 * The raw records are run through the SAME `adapter.normalizeRecords(...)` +
 * `filterResourceRows(...)` the live adapter applies in its `onBatch` path, so
 * the normalized rows are equivalent to a live extraction of the same data.
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

  const cursor =
    (await getReadCursor(importJobId, resourceKey)) ??
    { importJobId, companyId, snapshotId, resourceKey, nextPage: 1, recordsRead: 0, exhausted: false }

  const resourceMeta = RESOURCES.find((r) => r.key === resourceKey) ?? {
    key: resourceKey,
    label: resourceKey,
    moduleKey: resourceKey,
  }

  // Nothing (more) to read: unsupported resource, empty resource, or exhausted.
  if (cursor.exhausted || cursor.nextPage > totalPages || totalPages === 0) {
    await upsertReadCursor({ ...cursor, exhausted: true })
    return emptyPage(resourceMeta, cursor.recordsRead)
  }

  const pageNumber = pageNumbers[cursor.nextPage - 1]
  const files = (pageParts.get(pageNumber) ?? []).sort()
  const rawRecords: unknown[] = []
  for (const file of files) {
    rawRecords.push(...(await readRawPage(snapshot.storagePrefix, file)))
  }

  const adapter = new QuickBooksImportAdapter()
  const filteredRaw = filterResourceRows(resourceKey, rawRecords)
  const normalizedRows = adapter.normalizeRecords(resourceKey, filteredRaw, snapshot.realmId)

  // Attachments: resolve each captured binary from the snapshot's own Storage
  // prefix (zero-copy — same `quickbooks-migration` bucket the live import
  // writes to). `_hisabAttachment` is the exact shape `materializeAttachment`
  // consumes. QuickBooks is never called. Skipped / failed attachments get no
  // `_hisabAttachment`, so `materializeAttachment` returns null for them.
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

  const recordsRead = cursor.recordsRead + rawRecords.length
  const hasMore = cursor.nextPage < totalPages

  logger.info('quickbooks.snapshot.migration.page', {
    snapshotId,
    resource: resourceKey,
    importJobId,
    page: cursor.nextPage,
    totalPages,
    rawRecords: rawRecords.length,
    normalizedRows: normalizedRows.length,
    hasMore,
  })

  return {
    resource: { ...resourceMeta, rows: normalizedRows, hasMore },
    hasMore,
    checkpoint: { startPosition: cursor.nextPage + 1, fetched: recordsRead },
    commit: async () => {
      await upsertReadCursor({
        importJobId,
        companyId,
        snapshotId,
        resourceKey,
        nextPage: cursor.nextPage + 1,
        recordsRead,
        exhausted: !hasMore,
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
