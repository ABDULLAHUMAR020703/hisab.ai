import 'server-only'
import { createHash } from 'node:crypto'
import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'
import { quickBooksErrorStatus } from '@/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import {
  companyCurrencyCodes,
  currentExchangeRateAsOfDate,
  quickBooksExchangeRateWhere,
} from '../exchange-rates'
import { logger } from '@/lib/ops/logger'
import {
  appendSnapshotWarning,
  getCheckpoint,
  getSnapshot,
  listCheckpoints,
  patchSnapshotAttachmentBudget,
  saveCheckpoint,
  type SnapshotCheckpointRow,
} from './snapshot.service'
import {
  getSnapshotResourceSpec,
  UNSUPPORTED_HTTP_STATUSES,
  type SnapshotResourceSpec,
} from './snapshot-resources'
import { writeBinary, writeRawPage } from './snapshot-storage'
import { isTerminalEntityStatus, type SnapshotAttachmentLedgerEntry, type SnapshotPartitionWindow } from './snapshot-model'
import {
  attachmentFitsBudget,
  computeAttachmentBudget,
  RESERVED_SAFETY_BYTES,
  STORAGE_QUOTA_BYTES,
} from './snapshot-attachment-budget'
import {
  capturedBytesOf,
  firstAttachableEntityRef,
  listAttachmentLedger,
  summariseAttachmentLedger,
  upsertAttachmentLedgerEntry,
} from './snapshot-attachment-ledger'
import { measureProjectStorageUsage } from './snapshot-storage-usage'

/** Provider pages fetched per worker invocation before re-enqueueing. */
export const SNAPSHOT_PAGES_PER_STEP = Math.max(1, Number(process.env.QB_SNAPSHOT_PAGES_PER_STEP ?? 40))
const PAGE_SIZE = 1000

interface ProviderCheckpoint {
  startPosition: number
  partitionStart?: string
  partitionEnd?: string
  extractedCount: number
  hasMore?: boolean
  partitionComplete?: boolean
}

export interface ExtractResourceResult {
  resourceKey: string
  status: SnapshotCheckpointRow['status']
  pagesThisStep: number
  recordsThisStep: number
  done: boolean
}

/** Storage + checkpoint side effects, injectable so the core loop is testable. */
export interface QueryExtractionPorts {
  writeRawPage: typeof writeRawPage
  saveCheckpoint: (
    resourceKey: string,
    patch: Parameters<typeof saveCheckpoint>[2],
  ) => Promise<void>
}

/**
 * Extracts up to `pagesPerStep` raw provider pages for one query-backed resource,
 * resuming from `checkpoint`. Each page is persisted via `ports.writeRawPage`
 * BEFORE `ports.saveCheckpoint` advances the cursor, so an upload failure leaves
 * the cursor untouched and the page replays on the next run.
 */
export async function runQueryExtraction(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  spec: SnapshotResourceSpec
  snapshotId: string
  storagePrefix: string
  checkpoint: Pick<
    SnapshotCheckpointRow,
    'pagesWritten' | 'recordsWritten' | 'nextStartPosition' | 'partitionStart' | 'partitions'
  >
  pagesPerStep: number
  pageSize?: number
  ports: QueryExtractionPorts
}): Promise<ExtractResourceResult> {
  const { provider, context, spec, checkpoint, ports } = input
  if (!provider.getEntityRecords) throw new Error('Provider does not support entity queries.')

  const partitioned = spec.mode === 'query-partitioned'
  let page = checkpoint.pagesWritten
  let records = checkpoint.recordsWritten
  let pagesThisStep = 0
  let recordsThisStep = 0
  let last: ProviderCheckpoint | undefined
  // Seeded from prior steps so per-window record tallies accumulate across resumes.
  const partitions: SnapshotPartitionWindow[] = checkpoint.partitions.map((w) => ({ ...w }))

  const onPage = async (rows: unknown[], cp: ProviderCheckpoint) => {
    if (rows.length > 0) {
      page += 1
      const written = await ports.writeRawPage({
        prefix: input.storagePrefix,
        resourceKey: spec.resourceKey,
        entity: spec.entity,
        snapshotId: input.snapshotId,
        page,
        startPosition: cp.startPosition - rows.length,
        partitionStart: cp.partitionStart,
        partitionEnd: cp.partitionEnd,
        records: rows,
      })
      records += rows.length
      pagesThisStep += 1
      recordsThisStep += rows.length
      if (partitioned && cp.partitionStart && cp.partitionEnd) {
        accumulatePartitionWindow(partitions, cp.partitionStart, cp.partitionEnd, rows.length)
      }
      // The page bytes and this checkpoint advance persist together, so a crash
      // between them replays the page without double-counting the window tally.
      await ports.saveCheckpoint(spec.resourceKey, {
        nextStartPosition: cp.startPosition,
        partitionStart: cp.partitionStart ?? null,
        partitionEnd: cp.partitionEnd ?? null,
        pagesWritten: page,
        recordsWritten: records,
        lastPageFile: written.at(-1)?.file ?? null,
        partitions,
      })
    }
    last = cp
    if (partitioned && cp.partitionComplete && cp.partitionStart && cp.partitionEnd) {
      // Ensure even a fully-empty window is recorded so boundary continuity holds.
      accumulatePartitionWindow(partitions, cp.partitionStart, cp.partitionEnd, 0)
      await ports.saveCheckpoint(spec.resourceKey, { partitions })
    }
  }

  const onCheckpoint = async (cp: ProviderCheckpoint) => {
    last = cp
    if (partitioned && cp.partitionStart) {
      await ports.saveCheckpoint(spec.resourceKey, {
        nextStartPosition: cp.startPosition,
        partitionStart: cp.partitionStart,
        partitionEnd: cp.partitionEnd ?? null,
        partitions,
      })
    }
  }

  await provider.getEntityRecords(context, spec.entity, {
    includeInactive: spec.includeInactive,
    partitioned,
    where: spec.where,
    pageSize: input.pageSize ?? PAGE_SIZE,
    maxPages: input.pagesPerStep,
    startPosition: checkpoint.nextStartPosition,
    partitionStart: checkpoint.partitionStart ? new Date(checkpoint.partitionStart) : undefined,
    retainRows: false,
    onPage,
    onCheckpoint,
  })

  const hasMore = Boolean(last?.hasMore || last?.partitionComplete === true)
  const done = !hasMore
  await ports.saveCheckpoint(spec.resourceKey, {
    status: done ? 'completed' : 'running',
    pagesWritten: page,
    recordsWritten: records,
    partitions,
    ...(done ? { lastError: null } : {}),
  })

  return { resourceKey: spec.resourceKey, status: done ? 'completed' : 'running', pagesThisStep, recordsThisStep, done }
}

/**
 * Adds `records` to a date-partition window's running tally, creating the window
 * (with its bounds) if absent. The window is keyed by start-day, so pages of the
 * same window from different resumed steps accumulate into one entry. Contiguity
 * (end == next window start) is a natural property of the provider's 10-year
 * windowing and is asserted by validation.
 */
export function accumulatePartitionWindow(
  partitions: SnapshotPartitionWindow[],
  start: string,
  end: string,
  records: number,
): void {
  const startDay = start.slice(0, 10)
  const existing = partitions.find((p) => p.start.slice(0, 10) === startDay)
  if (existing) {
    existing.records += records
    existing.end = end
    return
  }
  partitions.push({ start, end, records })
  partitions.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * Wired entry: extracts the next step's worth of raw pages for one resource,
 * choosing the right mode and mapping errors to `unsupported` vs `failed`.
 */
export async function extractSnapshotResource(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  snapshotId: string
  companyId: string
  storagePrefix: string
  resourceKey: string
}): Promise<ExtractResourceResult> {
  const spec = getSnapshotResourceSpec(input.resourceKey)
  if (!spec) throw new Error(`Unknown snapshot resource: ${input.resourceKey}`)

  const checkpoint = await getCheckpoint(input.snapshotId, input.resourceKey)
  if (!checkpoint) throw new Error(`Missing checkpoint for ${input.resourceKey} on snapshot ${input.snapshotId}`)
  if (checkpoint.status === 'completed' || checkpoint.status === 'unsupported') {
    return { resourceKey: input.resourceKey, status: checkpoint.status, pagesThisStep: 0, recordsThisStep: 0, done: true }
  }

  await saveCheckpoint(input.snapshotId, input.resourceKey, { status: 'running', lastError: null })

  const ports: QueryExtractionPorts = {
    writeRawPage,
    saveCheckpoint: (resourceKey, patch) => saveCheckpoint(input.snapshotId, resourceKey, patch),
  }

  try {
    if (spec.mode === 'preferences') return await extractPreferences({ ...input, spec })
    if (spec.mode === 'exchange-rates') return await extractExchangeRates({ ...input, spec })
    if (spec.mode === 'attachments') return await extractAttachments({ ...input, spec, checkpoint })
    const result = await runQueryExtraction({
      provider: input.provider,
      context: input.context,
      spec,
      snapshotId: input.snapshotId,
      storagePrefix: input.storagePrefix,
      checkpoint,
      pagesPerStep: SNAPSHOT_PAGES_PER_STEP,
      ports,
    })
    logger.info('quickbooks.snapshot.resource.step', {
      snapshotId: input.snapshotId,
      resource: spec.resourceKey,
      entity: spec.entity,
      pagesThisStep: result.pagesThisStep,
      recordsThisStep: result.recordsThisStep,
      done: result.done,
    })
    return result
  } catch (error) {
    const status = quickBooksErrorStatus(error)
    if (status !== null && UNSUPPORTED_HTTP_STATUSES.has(status)) {
      const reason = error instanceof Error ? error.message : String(error)
      await saveCheckpoint(input.snapshotId, input.resourceKey, {
        status: 'unsupported',
        unsupportedReason: reason.slice(0, 2000),
        unsupportedStatus: status,
        lastError: null,
      })
      logger.info('quickbooks.snapshot.resource.unsupported', {
        snapshotId: input.snapshotId,
        resource: input.resourceKey,
        entity: spec.entity,
        status,
      })
      return { resourceKey: input.resourceKey, status: 'unsupported', pagesThisStep: 0, recordsThisStep: 0, done: true }
    }
    const message = error instanceof Error ? error.message : String(error)
    await saveCheckpoint(input.snapshotId, input.resourceKey, { status: 'failed', lastError: message.slice(0, 2000) })
    logger.error('quickbooks.snapshot.resource.failed', {
      snapshotId: input.snapshotId,
      resource: input.resourceKey,
      entity: spec.entity,
      error: message,
    })
    return { resourceKey: input.resourceKey, status: 'failed', pagesThisStep: 0, recordsThisStep: 0, done: true }
  }
}

async function extractPreferences(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  snapshotId: string
  storagePrefix: string
  spec: SnapshotResourceSpec
}): Promise<ExtractResourceResult> {
  const rows = input.provider.getPreferences ? await input.provider.getPreferences(input.context) : []
  if (rows.length) {
    await writeRawPage({
      prefix: input.storagePrefix,
      resourceKey: input.spec.resourceKey,
      entity: input.spec.entity,
      snapshotId: input.snapshotId,
      page: 1,
      startPosition: 1,
      records: rows,
    })
  }
  await saveCheckpoint(input.snapshotId, input.spec.resourceKey, {
    status: 'completed',
    pagesWritten: rows.length ? 1 : 0,
    recordsWritten: rows.length,
    lastPageFile: rows.length ? `${input.spec.resourceKey}/page-000001.json` : null,
    lastError: null,
  })
  return {
    resourceKey: input.spec.resourceKey,
    status: 'completed',
    pagesThisStep: rows.length ? 1 : 0,
    recordsThisStep: rows.length,
    done: true,
  }
}

async function extractExchangeRates(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  snapshotId: string
  storagePrefix: string
  spec: SnapshotResourceSpec
}): Promise<ExtractResourceResult> {
  const { provider, context } = input
  if (!provider.getEntityRecords) throw new Error('Provider does not support entity queries.')
  const currencies = companyCurrencyCodes(
    await provider.getEntityRecords(context, 'CompanyCurrency', { pageSize: 1000, maxRecords: 1000 }),
  )
  const where = quickBooksExchangeRateWhere(currencies, currentExchangeRateAsOfDate())
  const rows = where
    ? await provider.getEntityRecords(context, 'ExchangeRate', { where, pageSize: 1000, maxRecords: 1000 })
    : []
  if (rows.length) {
    await writeRawPage({
      prefix: input.storagePrefix,
      resourceKey: input.spec.resourceKey,
      entity: input.spec.entity,
      snapshotId: input.snapshotId,
      page: 1,
      startPosition: 1,
      records: rows,
    })
  }
  await saveCheckpoint(input.snapshotId, input.spec.resourceKey, {
    status: 'completed',
    pagesWritten: rows.length ? 1 : 0,
    recordsWritten: rows.length,
    lastPageFile: rows.length ? `${input.spec.resourceKey}/page-000001.json` : null,
    lastError: null,
  })
  return {
    resourceKey: input.spec.resourceKey,
    status: 'completed',
    pagesThisStep: rows.length ? 1 : 0,
    recordsThisStep: rows.length,
    done: true,
  }
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Storage + ledger side effects for the attachment phase, injectable for tests. */
export interface AttachmentExtractionPorts {
  writeRawPage: typeof writeRawPage
  writeBinary: (relativeFile: string, bytes: Uint8Array, contentType: string) => Promise<void>
  saveCheckpoint: (patch: Parameters<typeof saveCheckpoint>[2]) => Promise<void>
  loadLedger: () => Promise<SnapshotAttachmentLedgerEntry[]>
  upsertLedger: (entry: SnapshotAttachmentLedgerEntry) => Promise<void>
  appendWarning: (message: string) => Promise<void>
  downloadBinary: (attachableId: string) => Promise<{ bytes: Uint8Array; contentType: string | null }>
}

/**
 * Decides one attachment's fate against the remaining budget. The storage
 * ceiling is enforced HERE — never by letting Supabase reject an upload.
 */
export async function captureOneAttachment(input: {
  meta: Record<string, unknown>
  id: string
  budgetBytes: number
  capturedBytes: number
  ports: Pick<AttachmentExtractionPorts, 'writeBinary' | 'downloadBinary'>
}): Promise<SnapshotAttachmentLedgerEntry> {
  const { meta, id, budgetBytes, capturedBytes, ports } = input
  const fileName = String(meta.FileName ?? '').trim()
  const contentTypeMeta = typeof meta.ContentType === 'string' && meta.ContentType ? meta.ContentType : null
  const reportedSize = Number(meta.Size ?? 0)
  const sourceSize = Number.isFinite(reportedSize) && reportedSize > 0 ? reportedSize : null
  const remaining = Math.max(0, budgetBytes - capturedBytes)

  const base: SnapshotAttachmentLedgerEntry = {
    attachableId: id,
    entityRef: firstAttachableEntityRef(meta),
    fileName: fileName || null,
    contentType: contentTypeMeta,
    sourceSize,
    storagePath: null,
    status: 'pending',
    reason: null,
    capturedBytes: null,
    checksum: null,
  }

  if (!fileName) return { ...base, status: 'unavailable', reason: 'Attachable has no FileName' }
  if (budgetBytes <= 0) {
    return { ...base, status: 'skipped_budget', reason: 'attachment storage budget is exhausted; no binaries captured' }
  }
  // Pre-check against the QuickBooks-reported size — do not even download
  // something we already know cannot be stored.
  if (sourceSize != null && !attachmentFitsBudget({ budgetBytes, capturedBytes, sizeBytes: sourceSize })) {
    return { ...base, status: 'skipped_budget', reason: `reported ${sourceSize} B exceeds ${remaining} B remaining budget` }
  }

  let bytes: Uint8Array
  let contentType: string
  try {
    const download = await ports.downloadBinary(id)
    bytes = download.bytes
    contentType = contentTypeMeta ?? download.contentType ?? 'application/octet-stream'
  } catch (error) {
    return { ...base, status: 'failed', reason: `download failed: ${errMessage(error)}`.slice(0, 2000) }
  }

  // Authoritative check with the real byte length (covers a missing/wrong
  // reported Size).
  if (!attachmentFitsBudget({ budgetBytes, capturedBytes, sizeBytes: bytes.length })) {
    return {
      ...base,
      sourceSize: sourceSize ?? bytes.length,
      status: 'skipped_budget',
      reason: `actual ${bytes.length} B exceeds ${remaining} B remaining budget`,
    }
  }

  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  const relativePath = `attachments/${id}/${safe}`
  try {
    await ports.writeBinary(relativePath, bytes, contentType)
  } catch (error) {
    return { ...base, status: 'failed', reason: `storage write failed: ${errMessage(error)}`.slice(0, 2000) }
  }
  return {
    ...base,
    contentType,
    sourceSize: sourceSize ?? bytes.length,
    storagePath: relativePath,
    status: 'captured',
    capturedBytes: bytes.length,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  }
}

/**
 * Attachable metadata pages + storage-budgeted best-effort binary capture.
 *
 * Metadata (the raw Attachable pages, which carry every QBO reference) is
 * ALWAYS captured. Each binary is captured only if it fits the remaining
 * budget; otherwise it is recorded SKIPPED_BUDGET. A per-attachment ledger row
 * records every candidate. Budget exhaustion is never a resource failure.
 * Injectable ports keep the loop testable without a live provider/Storage.
 */
export async function runAttachmentExtraction(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  entity: string
  resourceKey: string
  snapshotId: string
  storagePrefix: string
  budgetBytes: number
  pagesPerStep: number
  pageSize: number
  checkpoint: Pick<SnapshotCheckpointRow, 'pagesWritten' | 'recordsWritten' | 'nextStartPosition'>
  ports: AttachmentExtractionPorts
}): Promise<ExtractResourceResult> {
  const { provider, context, ports, budgetBytes } = input
  if (!provider.getEntityRecords) throw new Error('Provider does not support entity queries.')

  const ledger = new Map<string, SnapshotAttachmentLedgerEntry>(
    (await ports.loadLedger()).map((entry) => [entry.attachableId, entry]),
  )
  let capturedBytes = capturedBytesOf([...ledger.values()])
  let page = input.checkpoint.pagesWritten
  let records = input.checkpoint.recordsWritten
  let pagesThisStep = 0
  let recordsThisStep = 0
  let last: ProviderCheckpoint | undefined

  await provider.getEntityRecords(context, input.entity, {
    pageSize: input.pageSize,
    maxPages: input.pagesPerStep,
    startPosition: input.checkpoint.nextStartPosition,
    retainRows: false,
    onPage: async (rows, cp) => {
      if (rows.length > 0) {
        page += 1
        // The raw metadata page (upsert: idempotent) and every per-attachment
        // ledger row (idempotent by PK) are written BEFORE the cursor advances,
        // so a crash mid-page replays the whole page on resume — no attachment
        // is ever dropped, and an already-CAPTURED binary is never re-downloaded.
        const written = await ports.writeRawPage({
          prefix: input.storagePrefix,
          resourceKey: input.resourceKey,
          entity: input.entity,
          snapshotId: input.snapshotId,
          page,
          startPosition: cp.startPosition - rows.length,
          records: rows,
        })

        for (const raw of rows) {
          const meta = raw as Record<string, unknown>
          const id = String(meta.Id ?? '')
          if (!id) continue
          const existing = ledger.get(id)
          if (existing && existing.status === 'captured') continue // resume: never re-download
          const entry = await captureOneAttachment({ meta, id, budgetBytes, capturedBytes, ports })
          ledger.set(id, entry)
          await ports.upsertLedger(entry)
          if (entry.status === 'captured') capturedBytes += entry.capturedBytes ?? 0
        }

        records += rows.length
        pagesThisStep += 1
        recordsThisStep += rows.length
        await ports.saveCheckpoint({
          nextStartPosition: cp.startPosition,
          pagesWritten: page,
          recordsWritten: records,
          lastPageFile: written.at(-1)?.file ?? null,
          attachmentSummary: summariseAttachmentLedger([...ledger.values()], {
            budgetBytes,
            metadataRecords: records,
          }),
        })
      }
      last = cp
    },
    onCheckpoint: async (cp) => {
      last = cp
    },
  })

  const hasMore = Boolean(last?.hasMore)
  const done = !hasMore
  const summary = summariseAttachmentLedger([...ledger.values()], { budgetBytes, metadataRecords: records })
  await ports.saveCheckpoint({
    status: done ? 'completed' : 'running',
    pagesWritten: page,
    recordsWritten: records,
    attachmentSummary: summary,
    lastError: null,
  })
  if (done && ((summary.skippedBudget ?? 0) > 0 || (summary.failed ?? 0) > 0 || (summary.unavailable ?? 0) > 0)) {
    await ports.appendWarning(
      `attachments: ${summary.captured}/${summary.totalCandidates} binaries captured ` +
        `(${summary.capturedBytes} B of ${budgetBytes} B budget); ` +
        `${summary.skippedBudget} skipped for storage budget, ${summary.failed} failed, ` +
        `${summary.unavailable} unavailable — accounting data is unaffected. ` +
        `Per-file detail: quickbooks_snapshot_attachments (snapshot_id=${input.snapshotId}).`,
    )
  }
  return { resourceKey: input.resourceKey, status: done ? 'completed' : 'running', pagesThisStep, recordsThisStep, done }
}

/**
 * Establishes the attachment-phase storage budget exactly once, when the
 * attachment phase begins (guaranteed after every non-attachment resource is
 * terminal — `attachments` is last in RESOURCE_ORDER). Fails safe: if project
 * storage usage cannot be measured, the budget is 0 and no binary is captured.
 */
async function ensureAttachmentBudget(snapshotId: string, companyId: string): Promise<number> {
  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found for company ${companyId}.`)
  if (snapshot.attachmentBudgetBytes != null) return snapshot.attachmentBudgetBytes

  const checkpoints = await listCheckpoints(snapshotId)
  const pendingCore = checkpoints.filter(
    (c) => c.resourceKey !== 'attachments' && !isTerminalEntityStatus(c.status),
  )
  if (pendingCore.length > 0) {
    throw new Error(
      `attachment phase started before core resources are terminal: ${pendingCore.map((c) => c.resourceKey).join(', ')}`,
    )
  }

  const quotaBytes = STORAGE_QUOTA_BYTES
  const reservedSafetyBytes = RESERVED_SAFETY_BYTES
  let baselineBytes: number
  try {
    baselineBytes = (await measureProjectStorageUsage()).totalBytes
  } catch (error) {
    baselineBytes = quotaBytes // forces the budget to 0
    await appendSnapshotWarning(
      snapshotId,
      `attachment budget: project storage usage could not be measured (${errMessage(error)}); ` +
        `capturing attachment metadata only, no binaries`,
    )
  }

  const attachmentBudgetBytes = computeAttachmentBudget({
    quotaBytes,
    currentUsageBytes: baselineBytes,
    reservedSafetyBytes,
  })
  await patchSnapshotAttachmentBudget(snapshotId, {
    storageQuotaBytes: quotaBytes,
    storageBaselineBytes: baselineBytes,
    attachmentReservedBytes: reservedSafetyBytes,
    attachmentBudgetBytes,
  })
  if (attachmentBudgetBytes <= 0) {
    await appendSnapshotWarning(
      snapshotId,
      `attachment budget is 0 B (quota ${quotaBytes}, in use ${baselineBytes}, reserved ${reservedSafetyBytes}); ` +
        `attachment binaries will not be captured — accounting data is unaffected`,
    )
  }
  logger.info('quickbooks.snapshot.attachments.budget', {
    snapshotId,
    quotaBytes,
    baselineBytes,
    reservedSafetyBytes,
    attachmentBudgetBytes,
  })
  return attachmentBudgetBytes
}

async function extractAttachments(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  snapshotId: string
  companyId: string
  storagePrefix: string
  spec: SnapshotResourceSpec
  checkpoint: SnapshotCheckpointRow
}): Promise<ExtractResourceResult> {
  const { provider, context, spec } = input
  if (!provider.getEntityRecords) throw new Error('Provider does not support entity queries.')

  const budgetBytes = await ensureAttachmentBudget(input.snapshotId, input.companyId)

  const ports: AttachmentExtractionPorts = {
    writeRawPage,
    writeBinary: (relativeFile, bytes, contentType) =>
      writeBinary(input.storagePrefix, relativeFile, bytes, contentType),
    saveCheckpoint: (patch) => saveCheckpoint(input.snapshotId, spec.resourceKey, patch),
    loadLedger: () => listAttachmentLedger(input.snapshotId),
    upsertLedger: (entry) => upsertAttachmentLedgerEntry(input.snapshotId, input.companyId, entry),
    appendWarning: (message) => appendSnapshotWarning(input.snapshotId, message),
    downloadBinary: async (attachableId) => {
      if (!provider.downloadAttachment) throw new Error('provider does not support attachment download')
      const download = await provider.downloadAttachment(context, attachableId)
      if (download.content) {
        return { bytes: new Uint8Array(download.content), contentType: download.contentType ?? null }
      }
      const response = await fetch(download.url, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: download.contentType ?? response.headers.get('content-type'),
      }
    },
  }

  const result = await runAttachmentExtraction({
    provider,
    context,
    entity: spec.entity,
    resourceKey: spec.resourceKey,
    snapshotId: input.snapshotId,
    storagePrefix: input.storagePrefix,
    budgetBytes,
    pagesPerStep: SNAPSHOT_PAGES_PER_STEP,
    pageSize: PAGE_SIZE,
    checkpoint: input.checkpoint,
    ports,
  })
  logger.info('quickbooks.snapshot.attachments.step', {
    snapshotId: input.snapshotId,
    budgetBytes,
    pagesThisStep: result.pagesThisStep,
    recordsThisStep: result.recordsThisStep,
    done: result.done,
  })
  return result
}
