import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeSnapshotStatus,
  EXTRACTOR_VERSION,
  type SnapshotAttachmentSummary,
  type SnapshotEntitySummary,
  type SnapshotStatus,
  type SnapshotValidationReport,
} from './snapshot-model'
import {
  allSnapshotResourceKeys,
  getSnapshotResourceSpec,
  requiredSnapshotResourceKeys,
} from './snapshot-resources'
import { snapshotPrefix } from './snapshot-storage'

export interface SnapshotRow {
  id: string
  companyId: string
  realmId: string
  status: SnapshotStatus
  storageBucket: string
  storagePrefix: string
  extractorVersion: string
  sourceCompany: Record<string, unknown> | null
  requestedResources: string[]
  entities: Record<string, SnapshotEntitySummary>
  errors: string[]
  warnings: string[]
  validation: SnapshotValidationReport | null
  startedAt: string
  completedAt: string | null
  // Attachment-phase storage budget context (migration 070); null until the
  // attachment phase starts.
  storageQuotaBytes: number | null
  storageBaselineBytes: number | null
  attachmentReservedBytes: number | null
  attachmentBudgetBytes: number | null
}

export interface SnapshotCheckpointRow {
  snapshotId: string
  companyId: string
  realmId: string
  resourceKey: string
  entity: string
  extractionMode: 'full' | 'partitioned'
  partitionStart: string | null
  partitionEnd: string | null
  nextStartPosition: number
  pagesWritten: number
  recordsWritten: number
  lastPageFile: string | null
  partitions: Array<{ start: string; end: string; records: number }>
  status: SnapshotEntitySummary['status']
  lastError: string | null
  unsupportedReason: string | null
  unsupportedStatus: number | null
  attachmentSummary: SnapshotAttachmentSummary | null
}

function mapSnapshot(row: Record<string, unknown>): SnapshotRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    realmId: String(row.realm_id),
    status: row.status as SnapshotStatus,
    storageBucket: String(row.storage_bucket),
    storagePrefix: String(row.storage_prefix),
    extractorVersion: String(row.extractor_version),
    sourceCompany: (row.source_company ?? null) as Record<string, unknown> | null,
    requestedResources: (row.requested_resources ?? []) as string[],
    entities: (row.entities ?? {}) as Record<string, SnapshotEntitySummary>,
    errors: (row.errors ?? []) as string[],
    warnings: (row.warnings ?? []) as string[],
    validation: (row.validation ?? null) as SnapshotValidationReport | null,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    storageQuotaBytes: row.storage_quota_bytes == null ? null : Number(row.storage_quota_bytes),
    storageBaselineBytes: row.storage_baseline_bytes == null ? null : Number(row.storage_baseline_bytes),
    attachmentReservedBytes: row.attachment_reserved_bytes == null ? null : Number(row.attachment_reserved_bytes),
    attachmentBudgetBytes: row.attachment_budget_bytes == null ? null : Number(row.attachment_budget_bytes),
  }
}

function mapCheckpoint(row: Record<string, unknown>): SnapshotCheckpointRow {
  return {
    snapshotId: String(row.snapshot_id),
    companyId: String(row.company_id),
    realmId: String(row.realm_id),
    resourceKey: String(row.resource_key),
    entity: String(row.entity),
    extractionMode: row.extraction_mode as 'full' | 'partitioned',
    partitionStart: row.partition_start ? String(row.partition_start) : null,
    partitionEnd: row.partition_end ? String(row.partition_end) : null,
    nextStartPosition: Number(row.next_start_position ?? 1),
    pagesWritten: Number(row.pages_written ?? 0),
    recordsWritten: Number(row.records_written ?? 0),
    lastPageFile: row.last_page_file ? String(row.last_page_file) : null,
    partitions: (row.partitions ?? []) as SnapshotCheckpointRow['partitions'],
    status: (row.status ?? 'pending') as SnapshotEntitySummary['status'],
    lastError: row.last_error ? String(row.last_error) : null,
    unsupportedReason: row.unsupported_reason ? String(row.unsupported_reason) : null,
    unsupportedStatus: row.unsupported_status == null ? null : Number(row.unsupported_status),
    attachmentSummary: (row.attachment_summary ?? null) as SnapshotAttachmentSummary | null,
  }
}

export async function createSnapshot(input: {
  companyId: string
  realmId: string
  userId: string
  requestedResources?: string[]
  sourceCompany?: Record<string, unknown> | null
}): Promise<SnapshotRow> {
  const db = createAdminClient()
  const requested = input.requestedResources?.length
    ? input.requestedResources.filter((key) => getSnapshotResourceSpec(key))
    : allSnapshotResourceKeys()
  if (!requested.length) throw new Error('No known QuickBooks snapshot resources were requested.')

  const inserted = await db
    .from('quickbooks_migration_snapshots')
    .insert({
      company_id: input.companyId,
      realm_id: input.realmId,
      status: 'RUNNING',
      storage_bucket: 'quickbooks-migration',
      storage_prefix: '', // set below once the id exists
      extractor_version: EXTRACTOR_VERSION,
      source_company: input.sourceCompany ?? null,
      requested_resources: requested,
      entities: {},
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (inserted.error) throw inserted.error

  const snapshotId = String(inserted.data.id)
  const prefix = snapshotPrefix(input.companyId, input.realmId, snapshotId)
  const withPrefix = await db
    .from('quickbooks_migration_snapshots')
    .update({ storage_prefix: prefix, updated_at: new Date().toISOString() })
    .eq('id', snapshotId)
    .select('*')
    .single()
  if (withPrefix.error) throw withPrefix.error

  const checkpointRows = requested.map((resourceKey) => {
    const spec = getSnapshotResourceSpec(resourceKey)!
    return {
      snapshot_id: snapshotId,
      company_id: input.companyId,
      realm_id: input.realmId,
      resource_key: resourceKey,
      entity: spec.entity,
      extraction_mode: spec.mode === 'query-partitioned' ? 'partitioned' : 'full',
      status: 'pending',
    }
  })
  const checkpoints = await db.from('quickbooks_snapshot_checkpoints').insert(checkpointRows)
  if (checkpoints.error) throw checkpoints.error

  return mapSnapshot(withPrefix.data)
}

export async function getSnapshot(snapshotId: string, companyId?: string): Promise<SnapshotRow | null> {
  let query = createAdminClient().from('quickbooks_migration_snapshots').select('*').eq('id', snapshotId)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data ? mapSnapshot(data) : null
}

export async function getLatestCompleteSnapshot(companyId: string, realmId: string): Promise<SnapshotRow | null> {
  const { data, error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .select('*')
    .eq('company_id', companyId)
    .eq('realm_id', realmId)
    .eq('status', 'COMPLETE')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? mapSnapshot(data) : null
}

export async function listSnapshots(companyId: string, limit = 25): Promise<SnapshotRow[]> {
  const { data, error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(mapSnapshot)
}

export async function listCheckpoints(snapshotId: string): Promise<SnapshotCheckpointRow[]> {
  const { data, error } = await createAdminClient()
    .from('quickbooks_snapshot_checkpoints')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .order('resource_key')
  if (error) throw error
  return (data ?? []).map(mapCheckpoint)
}

export async function getCheckpoint(snapshotId: string, resourceKey: string): Promise<SnapshotCheckpointRow | null> {
  const { data, error } = await createAdminClient()
    .from('quickbooks_snapshot_checkpoints')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .eq('resource_key', resourceKey)
    .maybeSingle()
  if (error) throw error
  return data ? mapCheckpoint(data) : null
}

export async function saveCheckpoint(
  snapshotId: string,
  resourceKey: string,
  patch: Partial<{
    entity: string
    extractionMode: 'full' | 'partitioned'
    partitionStart: string | null
    partitionEnd: string | null
    nextStartPosition: number
    pagesWritten: number
    recordsWritten: number
    lastPageFile: string | null
    partitions: SnapshotCheckpointRow['partitions']
    status: SnapshotEntitySummary['status']
    lastError: string | null
    unsupportedReason: string | null
    unsupportedStatus: number | null
    attachmentSummary: SnapshotAttachmentSummary | null
  }>,
): Promise<void> {
  const columns: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.entity !== undefined) columns.entity = patch.entity
  if (patch.extractionMode !== undefined) columns.extraction_mode = patch.extractionMode
  if (patch.partitionStart !== undefined) columns.partition_start = patch.partitionStart
  if (patch.partitionEnd !== undefined) columns.partition_end = patch.partitionEnd
  if (patch.nextStartPosition !== undefined) columns.next_start_position = patch.nextStartPosition
  if (patch.pagesWritten !== undefined) columns.pages_written = patch.pagesWritten
  if (patch.recordsWritten !== undefined) columns.records_written = patch.recordsWritten
  if (patch.lastPageFile !== undefined) columns.last_page_file = patch.lastPageFile
  if (patch.partitions !== undefined) columns.partitions = patch.partitions
  if (patch.status !== undefined) columns.status = patch.status
  if (patch.lastError !== undefined) columns.last_error = patch.lastError
  if (patch.unsupportedReason !== undefined) columns.unsupported_reason = patch.unsupportedReason
  if (patch.unsupportedStatus !== undefined) columns.unsupported_status = patch.unsupportedStatus
  if (patch.attachmentSummary !== undefined) columns.attachment_summary = patch.attachmentSummary

  const { error } = await createAdminClient()
    .from('quickbooks_snapshot_checkpoints')
    .update(columns)
    .eq('snapshot_id', snapshotId)
    .eq('resource_key', resourceKey)
  if (error) throw error
}

/** Rebuilds `entities` + overall `status` from the checkpoint rows. */
export async function refreshSnapshotSummary(snapshotId: string): Promise<SnapshotRow> {
  const [snapshot, checkpoints] = await Promise.all([getSnapshot(snapshotId), listCheckpoints(snapshotId)])
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`)

  const entities: Record<string, SnapshotEntitySummary> = {}
  for (const checkpoint of checkpoints) {
    entities[checkpoint.resourceKey] = {
      resourceKey: checkpoint.resourceKey,
      entity: checkpoint.entity,
      status: checkpoint.status,
      extractionMode: checkpoint.extractionMode,
      pages: checkpoint.pagesWritten,
      records: checkpoint.recordsWritten,
      files: [],
      partitions: checkpoint.partitions.length ? checkpoint.partitions : undefined,
      error: checkpoint.lastError ?? undefined,
      unsupportedReason: checkpoint.unsupportedReason ?? undefined,
      unsupportedStatus: checkpoint.unsupportedStatus ?? undefined,
      attachmentSummary: checkpoint.attachmentSummary ?? undefined,
    }
  }

  const required = requiredSnapshotResourceKeys(snapshot.requestedResources)
  const computed = computeSnapshotStatus(entities, required)
  // COMPLETE is written ONLY by saveSnapshotValidation, after validation passes.
  // Until then a would-be-COMPLETE snapshot sits at PARTIAL, so a COMPLETE row
  // can never exist without a validation report.
  const nextStatus = computed === 'COMPLETE' ? 'PARTIAL' : computed

  const patch: Record<string, unknown> = {
    entities,
    status: nextStatus,
    updated_at: new Date().toISOString(),
  }
  if ((computed === 'COMPLETE' || nextStatus === 'FAILED' || nextStatus === 'PARTIAL') && !snapshot.completedAt) {
    // completed_at marks "extraction finished" — set once every resource is terminal.
    patch.completed_at = new Date().toISOString()
  }

  const { data, error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update(patch)
    .eq('id', snapshotId)
    .select('*')
    .single()
  if (error) throw error
  return mapSnapshot(data)
}

/**
 * Puts a snapshot back to RUNNING so a queued retry re-finalizes it. Used when
 * finalization (manifest walk / validation) throws AFTER `refreshSnapshotSummary`
 * has already persisted a terminal status — a COMPLETE row must never exist
 * without a validation report. Checkpoints (all terminal, all correct) are left
 * untouched.
 */
export async function markSnapshotRefinalizing(snapshotId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update({ status: 'RUNNING', validation: null, completed_at: null, updated_at: new Date().toISOString() })
    .eq('id', snapshotId)
    .neq('status', 'RUNNING')
  if (error) throw error
}

export async function saveSnapshotValidation(
  snapshotId: string,
  validation: SnapshotValidationReport,
  finalStatus: SnapshotStatus,
): Promise<void> {
  const { error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update({
      validation,
      status: finalStatus,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', snapshotId)
  if (error) throw error
}

export interface SnapshotReadCursor {
  importJobId: string
  companyId: string
  snapshotId: string
  resourceKey: string
  /** 1-based index into the resource's ordered Storage page files. */
  nextPage: number
  /** Records of the page file at `nextPage` already consumed by earlier batches. */
  pageOffset: number
  recordsRead: number
  exhausted: boolean
}

export async function getReadCursor(importJobId: string, resourceKey: string): Promise<SnapshotReadCursor | null> {
  const { data, error } = await createAdminClient()
    .from('quickbooks_snapshot_read_cursors')
    .select('*')
    .eq('import_job_id', importJobId)
    .eq('resource_key', resourceKey)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    importJobId: String(data.import_job_id),
    companyId: String(data.company_id),
    snapshotId: String(data.snapshot_id),
    resourceKey: String(data.resource_key),
    nextPage: Number(data.next_page ?? 1),
    pageOffset: Number(data.page_offset ?? 0),
    recordsRead: Number(data.records_read ?? 0),
    exhausted: Boolean(data.exhausted),
  }
}

export async function upsertReadCursor(input: {
  importJobId: string
  companyId: string
  snapshotId: string
  resourceKey: string
  nextPage: number
  pageOffset: number
  recordsRead: number
  exhausted: boolean
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('quickbooks_snapshot_read_cursors')
    .upsert(
      {
        import_job_id: input.importJobId,
        company_id: input.companyId,
        snapshot_id: input.snapshotId,
        resource_key: input.resourceKey,
        next_page: input.nextPage,
        page_offset: input.pageOffset,
        records_read: input.recordsRead,
        exhausted: input.exhausted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'import_job_id,resource_key' },
    )
  if (error) throw error
}

/**
 * Persists the attachment-phase storage-budget context once, at the start of
 * the attachment phase. Idempotent: only writes when not already set.
 */
export async function patchSnapshotAttachmentBudget(
  snapshotId: string,
  budget: {
    storageQuotaBytes: number
    storageBaselineBytes: number
    attachmentReservedBytes: number
    attachmentBudgetBytes: number
  },
): Promise<void> {
  const { error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update({
      storage_quota_bytes: budget.storageQuotaBytes,
      storage_baseline_bytes: budget.storageBaselineBytes,
      attachment_reserved_bytes: budget.attachmentReservedBytes,
      attachment_budget_bytes: budget.attachmentBudgetBytes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', snapshotId)
    .is('attachment_budget_bytes', null)
  if (error) throw error
}

export async function appendSnapshotWarning(snapshotId: string, warning: string): Promise<void> {
  const snapshot = await getSnapshot(snapshotId)
  if (!snapshot) return
  const warnings = [...snapshot.warnings, warning].slice(-500)
  const { error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update({ warnings, updated_at: new Date().toISOString() })
    .eq('id', snapshotId)
  if (error) throw error
}

/**
 * Re-opens a PARTIAL/FAILED snapshot for another extraction pass: `failed`
 * resources reset to `pending`, `running` resources (from a crashed step) also
 * reset to `pending` so they resume from their checkpoint. `completed` and
 * `unsupported` resources are left untouched. Returns the resources that will
 * be retried.
 */
export async function reopenSnapshotForRetry(snapshotId: string, companyId: string): Promise<string[]> {
  const db = createAdminClient()
  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`)
  if (snapshot.status === 'COMPLETE') return []

  const checkpoints = await listCheckpoints(snapshotId)
  const retryable = checkpoints.filter((c) => c.status === 'failed' || c.status === 'running')
  for (const checkpoint of retryable) {
    await db
      .from('quickbooks_snapshot_checkpoints')
      .update({ status: 'pending', last_error: null, updated_at: new Date().toISOString() })
      .eq('snapshot_id', snapshotId)
      .eq('resource_key', checkpoint.resourceKey)
  }
  await db
    .from('quickbooks_migration_snapshots')
    .update({ status: 'RUNNING', completed_at: null, validation: null, updated_at: new Date().toISOString() })
    .eq('id', snapshotId)
  return retryable.map((c) => c.resourceKey)
}

export async function appendSnapshotError(snapshotId: string, message: string): Promise<void> {
  const snapshot = await getSnapshot(snapshotId)
  if (!snapshot) return
  const errors = [...snapshot.errors, message].slice(-500)
  const { error } = await createAdminClient()
    .from('quickbooks_migration_snapshots')
    .update({ errors, updated_at: new Date().toISOString() })
    .eq('id', snapshotId)
  if (error) throw error
}
