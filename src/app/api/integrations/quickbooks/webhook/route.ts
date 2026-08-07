import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractQuickBooksWebhookEvents, verifyQuickBooksWebhookSignature, type QuickBooksWebhookRow } from '@/lib/import-export/quickbooks/webhook-security'

export async function POST(request: Request) {
  const body = await request.text()
  if (!verifyQuickBooksWebhookSignature(body, request.headers.get('intuit-signature'), process.env.QB_WEBHOOK_VERIFIER)) return NextResponse.json({ error:'Invalid webhook signature' }, { status:401 })
  let payload: QuickBooksWebhookRow
  try { payload = JSON.parse(body) as QuickBooksWebhookRow } catch { return NextResponse.json({ error:'Invalid JSON' }, { status:400 }) }
  const events = extractQuickBooksWebhookEvents(payload)
  if (events.length) {
    const result = await createAdminClient().from('quickbooks_webhook_events').upsert(events, { onConflict:'event_id,realm_id,entity_type,entity_id,operation', ignoreDuplicates:true })
    if (result.error) return NextResponse.json({ error:'Unable to queue webhook' }, { status:500 })
  }
  return NextResponse.json({ accepted:events.length })
}
