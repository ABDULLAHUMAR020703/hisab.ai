import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/ops/logger'
import type { JobPriority, JobStatus } from '../types'

const HEARTBEAT_INTERVAL_MS = Math.max(5_000, Number(process.env.JOB_QUEUE_HEARTBEAT_MS ?? 30_000))
const STALE_JOB_TIMEOUT_MS = Math.max(HEARTBEAT_INTERVAL_MS * 3, Number(process.env.JOB_QUEUE_STALE_MS ?? 5 * 60_000))

export interface EnqueueJobInput {
  jobType: string
  companyId?: string | null
  payload?: Record<string, unknown>
  priority?: JobPriority
  scheduledAt?: Date
  maxAttempts?: number
  cronExpression?: string | null
  createdById?: string | null
}

export async function enqueueJob(input: EnqueueJobInput) {
  const client = createAdminClient()
  const { data, error } = await client
    .from('job_queue')
    .insert({
      company_id: input.companyId ?? null,
      job_type: input.jobType,
      payload: input.payload ?? {},
      priority: input.priority ?? 'NORMAL',
      scheduled_at: (input.scheduledAt ?? new Date()).toISOString(),
      max_attempts: input.maxAttempts ?? 3,
      cron_expression: input.cronExpression ?? null,
      created_by_id: input.createdById ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function claimNextJob(jobType?: string) {
  const client = createAdminClient()
  const now = new Date().toISOString()

  // A timed-out or redeployed worker must become claimable again. Migration
  // progress is durable in its checkpoint tables, so replay is safe.
  const stale = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString()
  const { data: recovered } = await client.from('job_queue').update({ status: 'PENDING', started_at: null, scheduled_at: now, updated_at: now, last_error: 'Recovered abandoned RUNNING job after heartbeat timeout.' })
    .eq('status', 'RUNNING').lt('updated_at', stale)
    .select('id')
  if (recovered?.length) logger.warn('platform.jobs.stale_recovered', { count: recovered.length, jobIds: recovered.map((row) => row.id), staleBefore: stale })

  let query = client
    .from('job_queue')
    .select('*')
    .eq('status', 'PENDING')
    .lte('scheduled_at', now)
    .order('priority', { ascending: false })
    .order('scheduled_at')
    .limit(1)
  if (jobType) query = query.eq('job_type', jobType)
  const { data: jobs } = await query

  const job = jobs?.[0]
  if (!job) return null

  const { data: claimed, error } = await client
    .from('job_queue')
    .update({
      status: 'RUNNING' as JobStatus,
      started_at: now,
      attempts: Number(job.attempts) + 1,
      updated_at: now,
    })
    .eq('id', job.id)
    .eq('status', 'PENDING')
    .select('*')
    .single()

  if (error || !claimed) return null
  return claimed
}

/** Refreshes ownership while a worker is executing a job. The attempt guard
 * prevents a stale worker from writing after another worker has reclaimed it. */
export async function heartbeatJob(jobId: string, attempt: number): Promise<boolean> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('job_queue')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'RUNNING')
    .eq('attempts', attempt)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) logger.warn('platform.jobs.ownership_lost', { jobId, attempt })
  return Boolean(data)
}

export { HEARTBEAT_INTERVAL_MS, STALE_JOB_TIMEOUT_MS }

export async function completeJob(jobId: string, result?: Record<string, unknown>, attempt?: number) {
  const client = createAdminClient()
  const { data: job } = await client.from('job_queue').select('*').eq('id', jobId).single()
  if (!job) return

  const completedAt = new Date().toISOString()
  let completion = client
    .from('job_queue')
    .update({
      status: 'COMPLETED',
      completed_at: completedAt,
      progress: 100,
      updated_at: completedAt,
    })
    .eq('id', jobId)
  if (attempt !== undefined) completion = completion.eq('status', 'RUNNING').eq('attempts', attempt)
  const { data: completed } = await completion.select('id').maybeSingle()
  if (!completed) return

  await client.from('job_history').insert({
    company_id: job.company_id,
    job_id: jobId,
    job_type: job.job_type,
    status: 'COMPLETED',
    payload: job.payload,
    result: result ?? {},
    duration_ms: job.started_at ? Date.now() - new Date(String(job.started_at)).getTime() : null,
  })

  if (job.cron_expression) {
    await enqueueJob({
      jobType: job.job_type,
      companyId: job.company_id,
      payload: job.payload as Record<string, unknown>,
      cronExpression: job.cron_expression,
      scheduledAt: nextCronRun(job.cron_expression),
    })
  }
}

export async function failJob(jobId: string, errorMessage: string, attempt?: number) {
  const client = createAdminClient()
  const { data: job } = await client.from('job_queue').select('*').eq('id', jobId).single()
  if (!job) return

  const attempts = Number(job.attempts)
  const maxAttempts = Number(job.max_attempts)

  if (attempts >= maxAttempts) {
    let terminal = client.from('job_queue').update({ status: 'FAILED', last_error: errorMessage, updated_at: new Date().toISOString() }).eq('id', jobId)
    if (attempt !== undefined) terminal = terminal.eq('status', 'RUNNING').eq('attempts', attempt)
    await terminal
    await client.from('dead_letter_queue').insert({
      company_id: job.company_id,
      job_id: jobId,
      job_type: job.job_type,
      payload: job.payload,
      error: errorMessage,
    })
  } else {
    const delayMs = Math.pow(2, attempts) * 1000
    let retry = client.from('job_queue').update({
      status: 'PENDING',
      last_error: errorMessage,
      scheduled_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId)
    if (attempt !== undefined) retry = retry.eq('status', 'RUNNING').eq('attempts', attempt)
    await retry
  }

  await client.from('job_history').insert({
    company_id: job.company_id,
    job_id: jobId,
    job_type: job.job_type,
    status: attempts >= maxAttempts ? 'DEAD' : 'FAILED',
    payload: job.payload,
    error: errorMessage,
  })
}

export async function updateJobProgress(jobId: string, progress: number, message?: string, attempt?: number) {
  const client = createAdminClient()
  let query = client.from('job_queue').update({
    progress: Math.min(100, Math.max(0, progress)),
    progress_message: message ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId)
  if (attempt !== undefined) query = query.eq('status', 'RUNNING').eq('attempts', attempt)
  await query
}

export async function getQueueStats(companyId?: string) {
  const client = createAdminClient()
  let query = client.from('job_queue').select('status')
  if (companyId) query = query.eq('company_id', companyId)
  const { data } = await query

  const stats: Record<string, number> = { PENDING: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, DEAD: 0 }
  for (const row of data ?? []) {
    const s = String(row.status)
    stats[s] = (stats[s] ?? 0) + 1
  }
  return stats
}

function nextCronRun(cron: string): Date {
  if (cron === '@daily') {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (cron === '@hourly') {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d
  }
  return new Date(Date.now() + 60_000)
}

export async function replayDeadLetter(dlqId: string) {
  const client = createAdminClient()
  const { data: dlq } = await client.from('dead_letter_queue').select('*').eq('id', dlqId).single()
  if (!dlq) throw new Error('Dead letter not found')

  const job = await enqueueJob({
    jobType: dlq.job_type,
    companyId: dlq.company_id,
    payload: dlq.payload as Record<string, unknown>,
  })

  await client.from('dead_letter_queue').update({ replayed_at: new Date().toISOString() }).eq('id', dlqId)
  return job
}
