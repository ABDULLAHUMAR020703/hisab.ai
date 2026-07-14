import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { JobPriority, JobStatus } from '../types'

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

export async function claimNextJob() {
  const client = createAdminClient()
  const now = new Date().toISOString()

  const { data: jobs } = await client
    .from('job_queue')
    .select('*')
    .eq('status', 'PENDING')
    .lte('scheduled_at', now)
    .order('priority', { ascending: false })
    .order('scheduled_at')
    .limit(1)

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

export async function completeJob(jobId: string, result?: Record<string, unknown>) {
  const client = createAdminClient()
  const { data: job } = await client.from('job_queue').select('*').eq('id', jobId).single()
  if (!job) return

  const completedAt = new Date().toISOString()
  await client
    .from('job_queue')
    .update({
      status: 'COMPLETED',
      completed_at: completedAt,
      progress: 100,
      updated_at: completedAt,
    })
    .eq('id', jobId)

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

export async function failJob(jobId: string, errorMessage: string) {
  const client = createAdminClient()
  const { data: job } = await client.from('job_queue').select('*').eq('id', jobId).single()
  if (!job) return

  const attempts = Number(job.attempts)
  const maxAttempts = Number(job.max_attempts)

  if (attempts >= maxAttempts) {
    await client.from('job_queue').update({ status: 'DEAD', last_error: errorMessage, updated_at: new Date().toISOString() }).eq('id', jobId)
    await client.from('dead_letter_queue').insert({
      company_id: job.company_id,
      job_id: jobId,
      job_type: job.job_type,
      payload: job.payload,
      error: errorMessage,
    })
  } else {
    const delayMs = Math.pow(2, attempts) * 1000
    await client.from('job_queue').update({
      status: 'PENDING',
      last_error: errorMessage,
      scheduled_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId)
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

export async function updateJobProgress(jobId: string, progress: number, message?: string) {
  const client = createAdminClient()
  await client.from('job_queue').update({
    progress: Math.min(100, Math.max(0, progress)),
    progress_message: message ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId)
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
