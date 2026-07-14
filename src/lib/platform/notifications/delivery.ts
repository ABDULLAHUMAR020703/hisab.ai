import 'server-only'

export async function deliverEmailNotification(notificationId: string) {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient()

  const { data: notification } = await client
    .from('platform_notifications')
    .select('*')
    .eq('id', notificationId)
    .single()

  if (!notification) return

  // Provider hook — integrate Resend/Twilio via integration_connections
  await client.from('notification_delivery_log').insert({
    company_id: notification.company_id,
    notification_id: notificationId,
    channel: notification.channel,
    provider: 'resend',
    status: 'QUEUED',
    response: { message: 'Email delivery queued — configure Resend integration' },
  })

  await client
    .from('platform_notifications')
    .update({ status: 'SENT', sent_at: new Date().toISOString() })
    .eq('id', notificationId)
}
