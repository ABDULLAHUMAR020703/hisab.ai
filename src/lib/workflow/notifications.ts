import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createWorkflowNotification(input: {
  companyId: string
  userId: string
  instanceId?: string | null
  taskId?: string | null
  type: 'ASSIGNMENT' | 'REMINDER' | 'ESCALATION' | 'DECISION' | 'COMPLETED'
  title: string
  body?: string | null
}) {
  const client = createAdminClient()
  const { error } = await client.from('workflow_notifications').insert({
    company_id: input.companyId,
    user_id: input.userId,
    instance_id: input.instanceId ?? null,
    task_id: input.taskId ?? null,
    notification_type: input.type,
    title: input.title,
    body: input.body ?? null,
  })
  if (error) throw error

  try {
    const { mirrorWorkflowNotification } = await import('@/lib/platform/notifications/service')
    await mirrorWorkflowNotification({
      companyId: input.companyId,
      userId: input.userId,
      title: input.title,
      body: input.body ?? undefined,
      instanceId: input.instanceId ?? undefined,
      taskId: input.taskId ?? undefined,
    })
  } catch {
    // Platform notification center optional until migration 037 applied
  }
}

export async function listUserNotifications(userId: string, companyId: string, unreadOnly = false) {
  const client = createAdminClient()
  let query = client
    .from('workflow_notifications')
    .select('*')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (unreadOnly) query = query.is('read_at', null)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const client = createAdminClient()
  await client
    .from('workflow_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
}
