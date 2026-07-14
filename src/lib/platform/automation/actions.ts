import type { AutomationAction, PlatformEvent } from '../types'
import { evaluateConditions } from './conditions'

export async function executeAction(
  action: AutomationAction,
  event: PlatformEvent,
): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'NOTIFY': {
      const { sendNotification } = await import('../notifications/service')
      await sendNotification({
        companyId: event.companyId,
        userId: String(action.config?.userId ?? event.userId ?? ''),
        category: String(action.config?.category ?? 'AUTOMATION'),
        title: String(action.config?.title ?? `Event: ${event.eventType}`),
        body: String(action.config?.body ?? ''),
        sourceType: event.entityType,
        sourceId: event.entityId,
      })
      return { action: 'NOTIFY', sent: true }
    }
    case 'WEBHOOK': {
      const { triggerWebhook } = await import('../webhooks/delivery')
      await triggerWebhook({
        companyId: event.companyId,
        eventType: event.eventType,
        payload: { ...event.payload, entityType: event.entityType, entityId: event.entityId },
      })
      return { action: 'WEBHOOK', triggered: true }
    }
    case 'ENQUEUE_JOB': {
      const { enqueueJob } = await import('../jobs/queue')
      await enqueueJob({
        jobType: String(action.config?.jobType ?? 'AUTOMATION_RUN'),
        companyId: event.companyId,
        payload: { ...(action.config?.payload as Record<string, unknown> ?? {}), event },
      })
      return { action: 'ENQUEUE_JOB', enqueued: true }
    }
    case 'CREATE_JOURNAL': {
      return { action: 'CREATE_JOURNAL', status: 'delegated_to_posting_service', entityId: event.entityId }
    }
    case 'GENERATE_PDF': {
      return { action: 'GENERATE_PDF', status: 'queued', entityId: event.entityId }
    }
    case 'SEND_EMAIL': {
      const { sendNotification } = await import('../notifications/service')
      await sendNotification({
        companyId: event.companyId,
        userId: String(action.config?.userId ?? ''),
        channel: 'EMAIL',
        category: 'AUTOMATION',
        title: String(action.config?.subject ?? 'Notification'),
        body: String(action.config?.body ?? ''),
      })
      return { action: 'SEND_EMAIL', sent: true }
    }
    default:
      return { action: action.type, status: 'unknown_action' }
  }
}
