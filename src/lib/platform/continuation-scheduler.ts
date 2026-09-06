import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueJob } from '@/lib/platform/jobs/queue'
import { logger } from '@/lib/ops/logger'

export async function ensureContinuationForImportJob(input: {
  importJobId: string
  companyId: string
  moduleKey: string
  userId: string
}): Promise<{ created?: Record<string, unknown>; existing?: { id: string; status: string; attempts: number | null } }> {
  const admin = createAdminClient()
  // Check for an active continuation first
  const { data: existingRows, error: fetchErr } = await admin
    .from('job_queue')
    .select('id,status,attempts,updated_at')
    .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
    .eq('company_id', input.companyId)
    .filter("payload->>importJobId", 'eq', input.importJobId)
    .in('status', ['PENDING','RUNNING'])
    .order('updated_at', { ascending: false })
    .limit(1)
  if (fetchErr) throw fetchErr
  if (existingRows && existingRows.length) {
    const r = existingRows[0] as any
    logger.info('quickbooks.continuation.exists', { importJobId: input.importJobId, existingPlatformJobId: r.id, existingStatus: r.status, existingAttempts: r.attempts })
    return { existing: { id: String(r.id), status: String(r.status), attempts: r.attempts ?? null } }
  }

  // No active continuation found — try to insert a new durable platform job.
  try {
    const job = await enqueueJob({
      jobType: 'QUICKBOOKS_IMPORT_STEP',
      companyId: input.companyId,
      payload: { importJobId: input.importJobId, moduleKey: input.moduleKey, companyId: input.companyId, userId: input.userId },
    })
    logger.info('quickbooks.continuation.created', { importJobId: input.importJobId, continuationPlatformJobId: job.id })
    return { created: job }
  } catch (error) {
    // Unique constraint race — fetch the existing active row and return it.
    if ((error as { code?: string })?.code !== '23505') throw error
    const { data: rows, error: re } = await admin
      .from('job_queue')
      .select('id,status,attempts')
      .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
      .eq('company_id', input.companyId)
      .filter("payload->>importJobId", 'eq', input.importJobId)
      .in('status', ['PENDING','RUNNING'])
      .order('updated_at', { ascending: false })
      .limit(1)
    if (re) throw re
    const existing = rows && rows.length ? rows[0] as any : null
    logger.info('quickbooks.continuation.race_existing', { importJobId: input.importJobId, existingPlatformJobId: existing?.id ?? null, existingStatus: existing?.status ?? null })
    return existing ? { existing: { id: String(existing.id), status: String(existing.status), attempts: existing.attempts ?? null } } : {}
  }
}

export async function recoverOrphanedContinuations(companyId?: string, minAgeMs = 5000) {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - minAgeMs).toISOString()
  // Only consider import jobs that look like they've committed a batch (processed_rows > 0),
  // are non-terminal, appear to have more to do (processed_rows < total_rows),
  // and whose heartbeat is stale.
  let query = admin.from('import_jobs')
    .select('id,module_key,user_id,company_id,processed_rows,total_rows,started_at,last_heartbeat_at,migration_session_id')
    .eq('status', 'processing')
    .lt('last_heartbeat_at', cutoff)
  if (companyId) query = query.eq('company_id', companyId)
  const { data: jobs, error } = await query
  if (error) throw error
  let created = 0; let skipped = 0
  for (const row of (jobs ?? []) as any[]) {
    // Require a committed checkpoint (processed_rows > 0)
    if (!(Number(row.processed_rows) > 0)) { skipped++; continue }
    // Require an indication that there is more work: processed_rows < total_rows
    // If total_rows is zero or null, skip (we cannot assume hasMore)
    const processed = Number(row.processed_rows ?? 0)
    const total = Number(row.total_rows ?? 0)
    if (!(total > 0 && processed < total)) { skipped++; continue }

    // Skip if the session owning this import job is cancelled
    if (row.migration_session_id) {
      const { data: sessions } = await admin.from('migration_wizard_sessions').select('id,status,config').eq('id', row.migration_session_id).limit(1)
      const session = sessions && sessions.length ? sessions[0] as any : null
      if (session) {
        try {
          // config.state === 'cancelled' or status === 'CANCELLED' means don't recover
          if (session.config && session.config.state === 'cancelled') { skipped++; continue }
          if (String(session.status) === 'CANCELLED') { skipped++; continue }
        } catch (_) {
          // ignore and continue
        }
      }
    }

    // Check for active continuation
    const { data: existing } = await admin
      .from('job_queue')
      .select('id,status,attempts')
      .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
      .eq('company_id', row.company_id)
      .filter("payload->>importJobId", 'eq', String(row.id))
      .in('status', ['PENDING','RUNNING'])
      .limit(1)
    if (existing && existing.length) { skipped++; continue }

    try {
      await enqueueJob({ jobType: 'QUICKBOOKS_IMPORT_STEP', companyId: row.company_id, payload: { importJobId: String(row.id), moduleKey: row.module_key, companyId: row.company_id, userId: row.user_id } })
      logger.info('quickbooks.continuation.recovered_created', { importJobId: row.id, companyId: row.company_id })
      created++
    } catch (err) {
      // if unique violation, another process already created — that's fine
      if ((err as { code?: string })?.code === '23505') { skipped++; continue }
      logger.error('quickbooks.continuation.recover_failed', { importJobId: row.id, companyId: row.company_id, error: err instanceof Error ? { message: err.message, name: err.name } : String(err) })
    }
  }
  logger.info('quickbooks.continuation.recover_summary', { created, skipped, scanned: (jobs ?? []).length })
  return { created, skipped, scanned: (jobs ?? []).length }
}

/**
 * Schedules the next QUICKBOOKS_SNAPSHOT_STEP for a snapshot whose extraction is
 * not finished. Same model as `ensureContinuationForImportJob`: check for an
 * active queue row first, otherwise insert a durable job and tolerate the
 * unique-index race. Called from the QUICKBOOKS_SNAPSHOT_STEP post-complete hook
 * (after the current step's row is COMPLETED) and from the snapshot create /
 * retry API routes for the first step.
 */
export async function ensureSnapshotContinuation(input: {
  snapshotId: string
  companyId: string
  userId: string
}): Promise<{ created?: Record<string, unknown>; existing?: { id: string; status: string; attempts: number | null } }> {
  const admin = createAdminClient()
  const findActive = async () => {
    const { data, error } = await admin
      .from('job_queue')
      .select('id,status,attempts')
      .eq('job_type', 'QUICKBOOKS_SNAPSHOT_STEP')
      .eq('company_id', input.companyId)
      .filter("payload->>snapshotId", 'eq', input.snapshotId)
      .in('status', ['PENDING', 'RUNNING'])
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return data && data.length ? (data[0] as { id: unknown; status: unknown; attempts: unknown }) : null
  }

  const existing = await findActive()
  if (existing) {
    logger.info('quickbooks.snapshot.continuation.exists', { snapshotId: input.snapshotId, existingPlatformJobId: existing.id, existingStatus: existing.status })
    return { existing: { id: String(existing.id), status: String(existing.status), attempts: (existing.attempts as number | null) ?? null } }
  }

  try {
    const job = await enqueueJob({
      jobType: 'QUICKBOOKS_SNAPSHOT_STEP',
      companyId: input.companyId,
      payload: { snapshotId: input.snapshotId, companyId: input.companyId, userId: input.userId },
      maxAttempts: 5,
    })
    logger.info('quickbooks.snapshot.continuation.created', { snapshotId: input.snapshotId, continuationPlatformJobId: job.id })
    return { created: job }
  } catch (error) {
    if ((error as { code?: string })?.code !== '23505') throw error
    const raced = await findActive()
    logger.info('quickbooks.snapshot.continuation.race_existing', { snapshotId: input.snapshotId, existingPlatformJobId: raced?.id ?? null })
    return raced ? { existing: { id: String(raced.id), status: String(raced.status), attempts: (raced.attempts as number | null) ?? null } } : {}
  }
}
