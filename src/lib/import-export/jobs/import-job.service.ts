import 'server-only'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { logger } from '@/lib/ops/logger'
import { assertImportJobSchemaCompatibility } from '@/lib/platform/schema-compatibility'
import type {
  DuplicateStrategy,
  FileFormat,
  ImportJobRecord,
  ImportJobStatus,
  ImportRowError,
  MigrationActivityEvent,
  MigrationProgressSnapshot,
  SkippedRecordDiagnostic,
} from '../types'

function mapJobRow(row: Record<string, unknown>): ImportJobRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    moduleKey: String(row.module_key),
    filename: String(row.filename),
    fileFormat: row.file_format as FileFormat,
    duplicateStrategy: (row.duplicate_strategy as DuplicateStrategy | null) ?? null,
    status: row.status as ImportJobStatus,
    totalRows: Number(row.total_rows ?? 0),
    importedCount: Number(row.imported_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    processedRows: Number(row.processed_rows ?? 0),
    validRows: row.valid_rows === null || row.valid_rows === undefined ? null : Number(row.valid_rows),
    invalidRows: row.invalid_rows === null || row.invalid_rows === undefined ? null : Number(row.invalid_rows),
    warningCount: row.warning_count === null || row.warning_count === undefined ? null : Number(row.warning_count),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    mappingSnapshot: (row.mapping_snapshot as Record<string, string> | null) ?? null,
    validationSummary: (row.validation_summary as Record<string, number> | null) ?? null,
    errorSummary: (row.error_summary as Record<string, number> | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    batchSize: Number(row.batch_size ?? 250),
    batchCursor: Number(row.batch_cursor ?? 0),
    retryCount: Number(row.retry_count ?? 0),
    pausedAt: row.paused_at ? String(row.paused_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    payloadSnapshot: (row.payload_snapshot as Record<string, unknown> | null) ?? null,
    progressSnapshot: (row.progress_snapshot as MigrationProgressSnapshot | null) ?? null,
    activityEvents: Array.isArray(row.activity_events) ? row.activity_events as MigrationActivityEvent[] : [],
    skipSummary: (row.skip_summary as Record<string, number> | null) ?? null,
  }
}

export async function createImportJob(input: {
  userId: string
  moduleKey: string
  filename: string
  fileFormat: FileFormat
  duplicateStrategy?: DuplicateStrategy
  mappingSnapshot?: Record<string, string>
  totalRows?: number
  payloadSnapshot?: Record<string, unknown>
  batchSize?: number
}): Promise<ImportJobRecord> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const now = new Date().toISOString()

  const { data, error } = await db
    .from('import_jobs')
    .insert({
      company_id: companyId,
      user_id: input.userId,
      module_key: input.moduleKey,
      filename: input.filename,
      file_format: input.fileFormat,
      duplicate_strategy: input.duplicateStrategy ?? null,
      status: 'processing',
      total_rows: input.totalRows ?? 0,
      mapping_snapshot: input.mappingSnapshot ?? null,
      started_at: now,
      payload_snapshot: input.payloadSnapshot ?? null,
      batch_size: input.batchSize ?? 250,
      last_heartbeat_at: now,
    })
    .select('*')
    .single()

  if (error) throw error
  logger.info('quickbooks.import_job.created', { importJobId: String(data.id), companyId, userId: input.userId, status: data.status, module: input.moduleKey })
  return mapJobRow(data)
}

export async function getImportJob(jobId: string, companyIdOverride?: string): Promise<ImportJobRecord | null> {
  await assertImportJobSchemaCompatibility()
  const db = supabaseDb()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await db
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error
  return data ? mapJobRow(data) : null
}

export async function updateImportJobProgress(
  jobId: string,
  processedRows: number,
  counts?: { importedCount?: number; updatedCount?: number; skippedCount?: number; failedCount?: number; validRows?: number; invalidRows?: number; warningCount?: number },
  totalRows?: number,
  observability?: { progressSnapshot?: MigrationProgressSnapshot; activityEvent?: MigrationActivityEvent },
  companyIdOverride?: string,
): Promise<void> {
  const db = supabaseDb()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const countPatch = counts ? { imported_count: counts.importedCount, updated_count: counts.updatedCount, skipped_count: counts.skippedCount, failed_count: counts.failedCount, ...(counts.validRows === undefined ? {} : { valid_rows: counts.validRows }), ...(counts.invalidRows === undefined ? {} : { invalid_rows: counts.invalidRows }), ...(counts.warningCount === undefined ? {} : { warning_count: counts.warningCount }) } : {}
  const patch: Record<string, unknown> = { processed_rows: processedRows, batch_cursor: processedRows, ...(totalRows === undefined ? {} : { total_rows: totalRows }), last_heartbeat_at: new Date().toISOString(), ...countPatch }
  if (observability?.progressSnapshot) patch.progress_snapshot = observability.progressSnapshot
  if (observability?.activityEvent) {
    const current = await db.from('import_jobs').select('activity_events').eq('id', jobId).eq('company_id', companyId).maybeSingle()
    if (current.error) throw current.error
    const events = Array.isArray(current.data?.activity_events) ? current.data.activity_events as MigrationActivityEvent[] : []
    patch.activity_events = [...events, observability.activityEvent].slice(-100)
  }
  logger.info('quickbooks.import_job.progress.persist_attempt', {
    importJobId: jobId,
    companyId,
    processedRows,
    totalRows,
    hasProgressSnapshot: Boolean(observability?.progressSnapshot),
    hasActivityEvent: Boolean(observability?.activityEvent),
    updatePayload: patch,
  })
  const { data: persisted, error } = await db
    .from('import_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('company_id', companyId)
    .select('id,company_id,status,processed_rows,total_rows,progress_snapshot,activity_events,last_heartbeat_at')
    .maybeSingle()

  if (error) {
    logger.error('quickbooks.import_job.progress.persist_failed', {
      importJobId: jobId,
      companyId,
      processedRows,
      error: { code: error.code, message: error.message, details: error.details, hint: error.hint },
    })
    throw error
  }
  if (!persisted) {
    const missing = new Error(`Import job progress update matched no row for job ${jobId} and company ${companyId}.`)
    logger.error('quickbooks.import_job.progress.persist_failed', {
      importJobId: jobId,
      companyId,
      processedRows,
      error: { code: 'IMPORT_JOB_NOT_FOUND', message: missing.message },
    })
    throw missing
  }
  logger.info('quickbooks.import_job.progress.persisted', {
    importJobId: String(persisted.id),
    companyId: String(persisted.company_id),
    status: persisted.status,
    processedRows: persisted.processed_rows,
    totalRows: persisted.total_rows,
    activityEventCount: Array.isArray(persisted.activity_events) ? persisted.activity_events.length : 0,
    hasProgressSnapshot: Boolean(persisted.progress_snapshot && Object.keys(persisted.progress_snapshot as Record<string, unknown>).length),
  })
}

export async function setImportJobStatus(jobId: string, status: 'processing' | 'paused' | 'pending'): Promise<ImportJobRecord | null> {
  const current = await getImportJob(jobId)
  if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) return current
  const db = supabaseDb(); const companyId = await resolveCompanyId()
  const patch: Record<string, unknown> = { status, last_heartbeat_at: new Date().toISOString(), paused_at: status === 'paused' ? new Date().toISOString() : null }
  logger.info('quickbooks.import_job.status.persist_attempt', { importJobId: jobId, companyId, fromStatus: current.status, toStatus: status })
  const { data, error } = await db.from('import_jobs').update(patch).eq('id', jobId).eq('company_id', companyId).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Import job status update matched no row for job ${jobId} and company ${companyId}.`)
  logger.info('quickbooks.import_job.status.persisted', { importJobId: jobId, companyId, status: data.status })
  return data ? mapJobRow(data) : null
}

export async function incrementImportJobRetry(jobId: string): Promise<void> {
  const job = await getImportJob(jobId); if (!job) return
  const db = supabaseDb(); const companyId = await resolveCompanyId()
  const { error } = await db.from('import_jobs').update({ retry_count: (job.retryCount ?? 0) + 1, status: 'pending', last_heartbeat_at: new Date().toISOString() }).eq('id', jobId).eq('company_id', companyId)
  if (error) throw error
}

export async function finalizeImportJob(
  jobId: string,
  input: {
    status: ImportJobStatus
    importedCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    totalRows: number
    validRows?: number
    invalidRows?: number
    warningCount?: number
    validationSummary?: Record<string, number>
    errorSummary?: Record<string, number>
    skipSummary?: Record<string, number>
    startedAt?: string | null
  },
): Promise<ImportJobRecord> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const completedAt = new Date()
  const startedAt = input.startedAt ? new Date(input.startedAt) : completedAt
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime())
  const processedRows = input.importedCount + input.updatedCount + input.skippedCount + input.failedCount

  logger.info('quickbooks.import_job.finalize.persist_attempt', { importJobId: jobId, companyId, status: input.status, totalRows: input.totalRows, processedRows })

  const { data, error } = await db
    .from('import_jobs')
    .update({
      status: input.status,
      imported_count: input.importedCount,
      updated_count: input.updatedCount,
      skipped_count: input.skippedCount,
      failed_count: input.failedCount,
      total_rows: input.totalRows,
      processed_rows: processedRows,
      valid_rows: input.validRows ?? null,
      invalid_rows: input.invalidRows ?? null,
      warning_count: input.warningCount ?? null,
      validation_summary: input.validationSummary ?? null,
      error_summary: input.errorSummary ?? null,
      skip_summary: input.skipSummary ?? {},
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
    })
    .eq('id', jobId)
    .eq('company_id', companyId)
    .select('*')
    .single()

  if (error) throw error
  logger.info('quickbooks.import_job.finalize.persisted', { importJobId: jobId, companyId, status: data.status, processedRows: data.processed_rows, importedCount: data.imported_count, failedCount: data.failed_count })
  return mapJobRow(data)
}

export async function saveImportJobSkips(jobId: string, skips: SkippedRecordDiagnostic[]): Promise<void> {
  if (skips.length === 0) return
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const payload = skips.map((skip) => ({ company_id: companyId, job_id: jobId, row_number: skip.rowNumber, source_id: skip.sourceId ?? null, record_name: skip.recordName ?? null, skip_reason: skip.reason, duplicate_key: skip.duplicateKey ?? null, existing_record_id: skip.existingRecordId ?? null }))
  const { error } = await db.from('import_job_skips').upsert(payload, { onConflict: 'job_id,row_number' })
  if (error) throw error
}

export async function getImportJobSkips(jobId: string): Promise<SkippedRecordDiagnostic[]> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db.from('import_job_skips').select('row_number,source_id,record_name,skip_reason,duplicate_key,existing_record_id').eq('job_id', jobId).eq('company_id', companyId).order('row_number', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({ rowNumber: Number(row.row_number), sourceId: row.source_id ? String(row.source_id) : undefined, recordName: row.record_name ? String(row.record_name) : undefined, reason: String(row.skip_reason) as SkippedRecordDiagnostic['reason'], duplicateKey: row.duplicate_key ? String(row.duplicate_key) : undefined, existingRecordId: row.existing_record_id ? String(row.existing_record_id) : undefined }))
}

export async function cancelImportJob(jobId: string): Promise<ImportJobRecord | null> {
  const job = await getImportJob(jobId)
  if (!job) return null
  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return job
  }

  return finalizeImportJob(jobId, {
    status: 'cancelled',
    importedCount: job.importedCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    totalRows: job.totalRows,
    validRows: job.validRows ?? undefined,
    invalidRows: job.invalidRows ?? undefined,
    warningCount: job.warningCount ?? undefined,
    validationSummary: job.validationSummary ?? undefined,
    errorSummary: job.errorSummary ?? undefined,
    startedAt: job.startedAt,
  })
}

const ERROR_BATCH_SIZE = 500

export async function saveImportJobErrors(
  jobId: string,
  errors: ImportRowError[],
): Promise<void> {
  if (errors.length === 0) return
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  for (let index = 0; index < errors.length; index += ERROR_BATCH_SIZE) {
    const chunk = errors.slice(index, index + ERROR_BATCH_SIZE)
    const payload = chunk.map((error) => ({
      company_id: companyId,
      job_id: jobId,
      row_number: error.rowNumber,
      field_key: error.fieldKey ?? null,
      error_code: error.errorCode,
      message: error.message,
      raw_row: error.rawRow ?? (error.details ? { _importError:error.details } : null),
    }))

    const { error } = await db.from('import_job_errors').insert(payload)
    if (error) throw error
  }
}

export async function getImportJobErrors(jobId: string): Promise<ImportRowError[]> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db
    .from('import_job_errors')
    .select('*')
    .eq('company_id', companyId)
    .eq('job_id', jobId)
    .order('row_number', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const rawRow=(row.raw_row as Record<string, unknown>|null)??undefined
    return {
      rowNumber: Number(row.row_number),
      fieldKey: row.field_key ? String(row.field_key) : undefined,
      errorCode: String(row.error_code),
      message: String(row.message),
      rawRow,
      details: rawRow?._importError && typeof rawRow._importError==='object' ? rawRow._importError as ImportRowError['details'] : undefined,
    }
  })
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const job = await getImportJob(jobId)
  return job?.status === 'cancelled'
}

export async function isJobPaused(jobId: string): Promise<boolean> {
  const job = await getImportJob(jobId)
  return job?.status === 'paused'
}

/** Marks abandoned workers as resumable instead of losing their cursor. */
export async function recoverStaleImportJobs(maxAgeMs = 5 * 60 * 1000): Promise<number> {
  const db = supabaseDb(); const companyId = await resolveCompanyId()
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const { data, error } = await db.from('import_jobs').update({ status: 'pending' }).eq('company_id', companyId).eq('status', 'processing').lt('last_heartbeat_at', cutoff).select('id')
  if (error) throw error
  return data?.length ?? 0
}
