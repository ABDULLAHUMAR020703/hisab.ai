import 'server-only'
import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'
import { quickBooksErrorStatus } from '@/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import {
  companyCurrencyCodes,
  currentExchangeRateAsOfDate,
  quickBooksExchangeRateWhere,
} from '../exchange-rates'
import { logger } from '@/lib/ops/logger'
import { getCheckpoint, saveCheckpoint, type SnapshotCheckpointRow } from './snapshot.service'
import {
  getSnapshotResourceSpec,
  UNSUPPORTED_HTTP_STATUSES,
  type SnapshotResourceSpec,
} from './snapshot-resources'
import { writeJson, writeRawPage } from './snapshot-storage'
import type { SnapshotPartitionWindow } from './snapshot-model'

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

/**
 * Attachable metadata pages + best-effort binary download. A failed binary
 * download is a recorded warning, not a resource failure — the metadata (which
 * carries the QBO references) is still captured.
 */
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

  let page = input.checkpoint.pagesWritten
  let records = input.checkpoint.recordsWritten
  let pagesThisStep = 0
  let recordsThisStep = 0
  let last: ProviderCheckpoint | undefined
  const index: Array<Record<string, unknown>> = []
  // Metadata capture (raw Attachable pages) is independent of binary download.
  let binariesDownloaded = input.checkpoint.attachmentSummary?.binariesDownloaded ?? 0
  let binariesFailed = input.checkpoint.attachmentSummary?.binariesFailed ?? 0

  await provider.getEntityRecords(context, spec.entity, {
    pageSize: PAGE_SIZE,
    maxPages: SNAPSHOT_PAGES_PER_STEP,
    startPosition: input.checkpoint.nextStartPosition,
    retainRows: false,
    onPage: async (rows, cp) => {
      if (rows.length > 0) {
        page += 1
        await writeRawPage({
          prefix: input.storagePrefix,
          resourceKey: spec.resourceKey,
          entity: spec.entity,
          snapshotId: input.snapshotId,
          page,
          startPosition: cp.startPosition - rows.length,
          records: rows,
        })
        records += rows.length
        pagesThisStep += 1
        recordsThisStep += rows.length
        for (const raw of rows) {
          const meta = raw as Record<string, unknown>
          const id = String(meta.Id ?? '')
          const fileName = String(meta.FileName ?? '').trim()
          if (!id || !fileName || !provider.downloadAttachment) {
            index.push({ id, fileName, downloaded: false, reason: 'no filename or provider download unavailable' })
            binariesFailed += 1
            continue
          }
          try {
            const download = await provider.downloadAttachment(context, id)
            const response = download.content ? null : await fetch(download.url, { signal: AbortSignal.timeout(60_000) })
            if (response && !response.ok) throw new Error(`HTTP ${response.status}`)
            const bytes = download.content
              ? new Uint8Array(download.content)
              : new Uint8Array(await response!.arrayBuffer())
            const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_')
            const contentType =
              download.contentType ?? response?.headers.get('content-type') ?? 'application/octet-stream'
            const { writeBinary } = await import('./snapshot-storage')
            await writeBinary(input.storagePrefix, `attachments/${id}/${safe}`, bytes, contentType)
            index.push({ id, fileName, storagePath: `attachments/${id}/${safe}`, contentType, downloaded: true })
            binariesDownloaded += 1
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            const { appendSnapshotWarning } = await import('./snapshot.service')
            await appendSnapshotWarning(input.snapshotId, `attachment binary ${id} (${fileName}) not downloaded: ${reason}`)
            index.push({ id, fileName, downloaded: false, reason })
            binariesFailed += 1
          }
        }
        await saveCheckpoint(input.snapshotId, spec.resourceKey, {
          nextStartPosition: cp.startPosition,
          pagesWritten: page,
          recordsWritten: records,
          attachmentSummary: { metadataRecords: records, binariesDownloaded, binariesFailed },
        })
      }
      last = cp
    },
    onCheckpoint: async (cp) => {
      last = cp
    },
  })

  if (index.length) {
    const prior =
      (await (await import('./snapshot-storage')).readJson<Array<Record<string, unknown>>>(
        input.storagePrefix,
        `${spec.resourceKey}/index.json`,
      )) ?? []
    await writeJson(input.storagePrefix, `${spec.resourceKey}/index.json`, [...prior, ...index])
  }

  const hasMore = Boolean(last?.hasMore)
  const done = !hasMore
  const attachmentSummary = { metadataRecords: records, binariesDownloaded, binariesFailed }
  await saveCheckpoint(input.snapshotId, spec.resourceKey, {
    status: done ? 'completed' : 'running',
    pagesWritten: page,
    recordsWritten: records,
    attachmentSummary,
    lastError: null,
  })
  if (done && binariesFailed > 0) {
    const { appendSnapshotWarning } = await import('./snapshot.service')
    await appendSnapshotWarning(
      input.snapshotId,
      `attachments: metadata captured for ${records} record(s); ${binariesDownloaded} binary file(s) downloaded, ${binariesFailed} failed (see attachments/index.json)`,
    )
  }
  return { resourceKey: spec.resourceKey, status: done ? 'completed' : 'running', pagesThisStep, recordsThisStep, done }
}
