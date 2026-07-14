import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { isSafeWebhookUrl } from '@/lib/security/ssrf'
import { generateWebhookSecret, hashSecret, signPayload } from './signing'

export { generateWebhookSecret, hashSecret, signPayload } from './signing'

export async function triggerWebhook(input: {
  companyId: string
  eventType: string
  payload: Record<string, unknown>
}) {
  const client = createAdminClient()
  const { data: endpoints } = await client
    .from('webhook_endpoints')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('direction', 'OUTGOING')
    .eq('is_active', true)

  const deliveries = []
  for (const endpoint of endpoints ?? []) {
    const events = (endpoint.events ?? []) as string[]
    if (events.length > 0 && !events.includes(input.eventType) && !events.includes('*')) continue

    const { data: delivery } = await client
      .from('webhook_deliveries')
      .insert({
        company_id: input.companyId,
        endpoint_id: endpoint.id,
        event_type: input.eventType,
        payload: input.payload,
        status: 'PENDING',
      })
      .select('*')
      .single()

    if (delivery) {
      deliveries.push(delivery)
      const { enqueueJob } = await import('../jobs/queue')
      await enqueueJob({
        jobType: 'WEBHOOK_RETRY',
        companyId: input.companyId,
        payload: { deliveryId: delivery.id },
        priority: 'HIGH',
      })
    }
  }
  return deliveries
}

export async function deliverWebhook(deliveryId: string) {
  const client = createAdminClient()
  const { data: delivery } = await client
    .from('webhook_deliveries')
    .select('*, endpoint:webhook_endpoints(*)')
    .eq('id', deliveryId)
    .single()

  if (!delivery) return

  const endpoint = delivery.endpoint as Record<string, unknown>
  const url = String(endpoint.url)
  const urlCheck = isSafeWebhookUrl(url)
  if (!urlCheck.ok) {
    await client.from('webhook_deliveries').update({
      status: 'FAILED',
      attempts: Number(delivery.attempts) + 1,
      response_body: `Blocked URL: ${urlCheck.reason}`,
    }).eq('id', deliveryId)
    return
  }

  const body = JSON.stringify(delivery.payload)
  const secretHash = endpoint.secret_hash as string | null
  const signature = secretHash ? signPayload(body, secretHash) : undefined

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Hisab-Signature': signature, 'X-Hisab-Event': String(delivery.event_type) } : {}),
      },
      body,
    })

    const responseBody = await res.text().catch(() => '')
    await client.from('webhook_deliveries').update({
      status: res.ok ? 'DELIVERED' : 'FAILED',
      attempts: Number(delivery.attempts) + 1,
      response_status: res.status,
      response_body: responseBody.substring(0, 2000),
      signature: signature ?? null,
      delivered_at: res.ok ? new Date().toISOString() : null,
      next_retry_at: res.ok ? null : new Date(Date.now() + 60_000).toISOString(),
    }).eq('id', deliveryId)
  } catch (err) {
    await client.from('webhook_deliveries').update({
      status: 'FAILED',
      attempts: Number(delivery.attempts) + 1,
      response_body: String(err),
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    }).eq('id', deliveryId)
    throw err
  }
}

export async function verifyIncomingWebhook(
  signature: string | null,
  body: string,
  companyId?: string,
): Promise<boolean> {
  if (!signature) return false
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data: endpoints } = await client
    .from('webhook_endpoints')
    .select('secret_hash')
    .eq('company_id', cid)
    .eq('direction', 'INCOMING')
    .eq('is_active', true)

  for (const ep of endpoints ?? []) {
    if (ep.secret_hash && signPayload(body, ep.secret_hash) === signature) return true
  }
  return false
}

export async function replayWebhookDelivery(deliveryId: string) {
  const { enqueueJob } = await import('../jobs/queue')
  const client = createAdminClient()
  const { data: delivery } = await client.from('webhook_deliveries').select('company_id').eq('id', deliveryId).single()
  await enqueueJob({
    jobType: 'WEBHOOK_RETRY',
    companyId: delivery?.company_id,
    payload: { deliveryId },
    priority: 'HIGH',
  })
}
