import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import {
  cancelImportJob,
  getImportJobsByIds,
  incrementImportJobRetry,
} from '@/lib/import-export/jobs/import-job.service'
import { FrameworkBadRequestError, FrameworkNotFoundError } from '@/lib/import-export/errors'
import {
  buildSessionConfig,
  importJobIdsFromConfig,
  isActiveMigrationSession,
  isQuickBooksMigrationConfig,
  jobRecordToProgressSnapshot,
  restoreLifecycleFromSession,
  summarizeMigrationSession,
  type HydratedMigrationSession,
  type MigrationHistorySummary,
  type MigrationSessionRecord,
  type MigrationSessionState,
  type MigrationSessionStatus,
  type MigrationSessionStep,
  type QuickBooksMigrationSessionConfig,
} from './migration-session'
import type { ModuleLifecycleState } from './module-lifecycle'
import type { DuplicateStrategy } from '../types'
import type { SelectableResource } from './module-lifecycle'

function mapSessionRow(row: Record<string, unknown>): MigrationSessionRecord {
  const config = row.config
  if (!isQuickBooksMigrationConfig(config)) {
    throw new FrameworkBadRequestError('Migration session is not a QuickBooks migration session.')
  }
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: row.user_id ? String(row.user_id) : null,
    step: String(row.step) as MigrationSessionStep,
    status: String(row.status) as MigrationSessionStatus,
    config,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

async function hydrateSession(session: MigrationSessionRecord): Promise<HydratedMigrationSession> {
  const jobIds = importJobIdsFromConfig(session.config)
  const jobs = await getImportJobsByIds(jobIds, session.companyId)
  const jobsByKey: HydratedMigrationSession['jobs'] = {}

  for (const [resourceKey, jobId] of Object.entries(session.config.importJobIds)) {
    const job = jobs.find((item) => item.id === jobId)
    if (job) jobsByKey[resourceKey] = jobRecordToProgressSnapshot(job)
  }
  for (const card of session.config.modules) {
    if (!card.jobId || jobsByKey[card.key]) continue
    const job = jobs.find((item) => item.id === card.jobId)
    if (job) jobsByKey[card.key] = jobRecordToProgressSnapshot(job)
  }

  return {
    ...session,
    jobs: jobsByKey,
    lifecycle: restoreLifecycleFromSession(session.config, jobsByKey),
  }
}

/** Returns the company's active QuickBooks migration session, if any. Never creates one. */
export async function findActiveQuickBooksMigrationSession(companyIdOverride?: string): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'IN_PROGRESS')
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw error
  const match = (data ?? []).find((row) => {
    try {
      return isActiveMigrationSession(mapSessionRow(row))
    } catch {
      return false
    }
  })
  if (!match) return null
  return hydrateSession(mapSessionRow(match))
}

/** Returns the latest QuickBooks session, including completed or failed sessions. */
export async function findLatestQuickBooksMigrationSession(companyIdOverride?: string): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw error
  const match = (data ?? []).find((row) => isQuickBooksMigrationConfig(row.config))
  return match ? hydrateSession(mapSessionRow(match)) : null
}

export async function listQuickBooksMigrationSessions(input?: {
  companyIdOverride?: string
  page?: number
  limit?: number
  status?: MigrationSessionState | ''
}): Promise<{ items: MigrationHistorySummary[]; total: number; page: number; limit: number }> {
  const client = createAdminClient()
  const companyId = input?.companyIdOverride ?? await resolveCompanyId()
  const page = Math.max(1, input?.page ?? 1)
  const limit = Math.min(50, Math.max(1, input?.limit ?? 25))
  const statusFilter = input?.status ?? ''

  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) throw error

  const quickbooksRows = (data ?? []).filter((row) => isQuickBooksMigrationConfig(row.config))
  const filtered = statusFilter
    ? quickbooksRows.filter((row) => {
      try {
        return mapSessionRow(row).config.state === statusFilter
      } catch {
        return false
      }
    })
    : quickbooksRows

  const total = filtered.length
  const slice = filtered.slice((page - 1) * limit, page * limit)
  const items: MigrationHistorySummary[] = []
  for (const row of slice) {
    const hydrated = await hydrateSession(mapSessionRow(row))
    items.push(summarizeMigrationSession(hydrated))
  }
  return { items, total, page, limit }
}

export async function getQuickBooksMigrationSession(sessionId: string, companyIdOverride?: string): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  if (!isQuickBooksMigrationConfig(data.config)) return null
  return hydrateSession(mapSessionRow(data))
}

export async function createQuickBooksMigrationSession(input: {
  userId: string
  selectedModules: SelectableResource[]
  duplicateStrategy: DuplicateStrategy
  lifecycle: ModuleLifecycleState
  sourceLabel?: string | null
  companyName?: string | null
  currency?: string | null
  companyIdOverride?: string
}): Promise<HydratedMigrationSession> {
  const companyId = input.companyIdOverride ?? await resolveCompanyId()
  const existing = await findActiveQuickBooksMigrationSession(companyId)
  if (existing) {
    throw new FrameworkBadRequestError('Migration already running')
  }

  const config = buildSessionConfig({
    selectedModules: input.selectedModules,
    duplicateStrategy: input.duplicateStrategy,
    lifecycle: input.lifecycle,
    sourceLabel: input.sourceLabel,
    companyName: input.companyName,
    currency: input.currency,
    state: 'running',
  })

  const client = createAdminClient()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .insert({
      company_id: companyId,
      user_id: input.userId,
      step: 'import',
      status: 'IN_PROGRESS',
      config,
    })
    .select('*')
    .single()

  if (error) throw error
  return hydrateSession(mapSessionRow(data))
}

export async function updateQuickBooksMigrationSession(input: {
  sessionId: string
  lifecycle?: ModuleLifecycleState
  selectedModules?: SelectableResource[]
  duplicateStrategy?: DuplicateStrategy
  step?: MigrationSessionStep
  state?: MigrationSessionState
  status?: MigrationSessionStatus
  companyIdOverride?: string
}): Promise<HydratedMigrationSession> {
  const companyId = input.companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(input.sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')

  const config: QuickBooksMigrationSessionConfig = buildSessionConfig({
    selectedModules: input.selectedModules ?? current.config.selectedModules,
    duplicateStrategy: input.duplicateStrategy ?? current.config.duplicateStrategy,
    lifecycle: input.lifecycle ?? current.lifecycle,
    startedAt: current.config.startedAt,
    sourceLabel: current.config.sourceLabel,
    companyName: current.config.companyName,
    currency: current.config.currency,
    state: input.state ?? current.config.state,
  })

  let status = input.status ?? current.status
  if (input.state === 'completed' || input.state === 'failed') status = 'COMPLETED'
  if (input.state === 'cancelled') status = 'CANCELLED'

  const client = createAdminClient()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .update({
      step: input.step ?? current.step,
      status,
      config,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.sessionId)
    .eq('company_id', companyId)
    .select('*')
    .single()

  if (error) throw error
  return hydrateSession(mapSessionRow(data))
}

export async function cancelQuickBooksMigrationSession(sessionId: string, companyIdOverride?: string): Promise<HydratedMigrationSession> {
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')

  const jobIds = importJobIdsFromConfig(current.config)
  for (const jobId of jobIds) {
    await cancelImportJob(jobId)
  }

  const refreshed = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!refreshed) throw new FrameworkNotFoundError('Migration session not found')

  return updateQuickBooksMigrationSession({
    sessionId,
    companyIdOverride: companyId,
    state: 'cancelled',
    status: 'CANCELLED',
    step: refreshed.step,
    lifecycle: refreshed.lifecycle,
  })
}

export async function retryQuickBooksMigrationSession(sessionId: string, companyIdOverride?: string): Promise<HydratedMigrationSession> {
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')

  const failedJobIds = Object.values(current.jobs)
    .filter((job) => job.status === 'failed')
    .map((job) => job.id)

  if (failedJobIds.length === 0) {
    throw new FrameworkBadRequestError('No failed migration jobs are available to retry.')
  }

  for (const jobId of failedJobIds) {
    await incrementImportJobRetry(jobId)
  }

  const refreshed = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!refreshed) throw new FrameworkNotFoundError('Migration session not found')
  const retryLifecycle: ModuleLifecycleState = Object.fromEntries(
    Object.entries(refreshed.lifecycle).map(([key, entry]) => [
      key,
      entry.phase === 'failed'
        ? { ...entry, phase: 'queued' as const, failure: null }
        : entry,
    ]),
  )

  return updateQuickBooksMigrationSession({
    sessionId,
    companyIdOverride: companyId,
    state: 'running',
    status: 'IN_PROGRESS',
    step: 'import',
    lifecycle: retryLifecycle,
  })
}
