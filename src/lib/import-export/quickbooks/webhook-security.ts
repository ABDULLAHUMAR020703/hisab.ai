import { createHmac, timingSafeEqual } from 'node:crypto'

export type QuickBooksWebhookRow = Record<string, unknown>

export function verifyQuickBooksWebhookSignature(body: string, signature: string | null, verifier: string | undefined) {
  if (!verifier || !signature) return false
  const expected = Buffer.from(createHmac('sha256', verifier).update(body, 'utf8').digest('base64'))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function extractQuickBooksWebhookEvents(payload: QuickBooksWebhookRow) {
  const notifications = Array.isArray(payload.eventNotifications) ? payload.eventNotifications as QuickBooksWebhookRow[] : []
  const events: QuickBooksWebhookRow[] = []
  for (const notification of notifications) {
    const realmId = String(notification.realmId ?? '')
    const entities = ((notification.dataChangeEvent as QuickBooksWebhookRow | undefined)?.entities ?? []) as QuickBooksWebhookRow[]
    for (const entity of entities) {
      const entityType = String(entity.name ?? '')
      const entityId = String(entity.id ?? '')
      const operation = String(entity.operation ?? 'Update')
      const eventTime = String(entity.lastUpdated ?? new Date().toISOString())
      if (!realmId || !entityType || !entityId) continue
      events.push({ event_id:`${realmId}:${entityType}:${entityId}:${operation}:${eventTime}`, realm_id:realmId, entity_type:entityType, entity_id:entityId, operation, event_time:eventTime, payload:{ realmId, ...entity }, status:'pending' })
    }
  }
  return events
}
