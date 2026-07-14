import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import type { NotificationChannel } from '../types'

export async function sendNotification(input: {
  companyId: string
  userId?: string | null
  channel?: NotificationChannel
  category?: string
  title: string
  body?: string
  payload?: Record<string, unknown>
  sourceType?: string
  sourceId?: string
}) {
  const client = createAdminClient()
  const channel = input.channel ?? 'IN_APP'

  const enabled = input.userId
    ? await isChannelEnabled(input.companyId, input.userId, input.category ?? 'SYSTEM', channel)
    : true

  if (!enabled) return null

  const { data, error } = await client
    .from('platform_notifications')
    .insert({
      company_id: input.companyId,
      user_id: input.userId ?? null,
      channel,
      category: input.category ?? 'SYSTEM',
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? {},
      status: channel === 'IN_APP' ? 'SENT' : 'PENDING',
      sent_at: channel === 'IN_APP' ? new Date().toISOString() : null,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error

  if (channel !== 'IN_APP') {
    await enqueueDelivery(data.id, channel, input.companyId)
  }

  return data
}

async function isChannelEnabled(
  companyId: string,
  userId: string,
  category: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const client = createAdminClient()
  const { data } = await client
    .from('notification_preferences')
    .select('is_enabled')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('category', category)
    .eq('channel', channel)
    .maybeSingle()
  if (!data) return true
  return data.is_enabled
}

async function enqueueDelivery(notificationId: string, channel: NotificationChannel, companyId: string) {
  const { enqueueJob } = await import('../jobs/queue')
  await enqueueJob({
    jobType: 'EMAIL_SEND',
    companyId,
    payload: { notificationId, channel },
    priority: 'NORMAL',
  })
}

export async function listNotifications(userId: string, companyId?: string, unreadOnly = false) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  let query = client
    .from('platform_notifications')
    .select('*')
    .eq('company_id', cid)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (unreadOnly) query = query.is('read_at', null)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function markRead(notificationId: string, userId: string) {
  const client = createAdminClient()
  const { error } = await client
    .from('platform_notifications')
    .update({ read_at: new Date().toISOString(), status: 'READ' })
    .eq('id', notificationId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function markAllRead(userId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  await client
    .from('platform_notifications')
    .update({ read_at: new Date().toISOString(), status: 'READ' })
    .eq('company_id', cid)
    .eq('user_id', userId)
    .is('read_at', null)
}

export async function getUnreadCount(userId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { count } = await client
    .from('platform_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', cid)
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 0
}

export async function upsertPreference(input: {
  userId: string
  category: string
  channel: NotificationChannel
  isEnabled: boolean
  companyId?: string
}) {
  const cid = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('notification_preferences')
    .upsert({
      company_id: cid,
      user_id: input.userId,
      category: input.category,
      channel: input.channel,
      is_enabled: input.isEnabled,
    }, { onConflict: 'company_id,user_id,category,channel' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Bridge workflow notifications into platform center */
export async function mirrorWorkflowNotification(input: {
  companyId: string
  userId: string
  title: string
  body?: string
  instanceId?: string
  taskId?: string
}) {
  return sendNotification({
    companyId: input.companyId,
    userId: input.userId,
    category: 'WORKFLOW',
    title: input.title,
    body: input.body,
    sourceType: 'WORKFLOW',
    sourceId: input.instanceId,
    payload: { taskId: input.taskId },
  })
}
