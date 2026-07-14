import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { evaluateConditions } from './conditions'
import { executeAction } from './actions'
import type { PlatformEvent } from '../types'

export async function executeAutomationRules(event: PlatformEvent) {
  const client = createAdminClient()
  const { data: rules, error } = await client
    .from('automation_rules')
    .select('*')
    .eq('company_id', event.companyId)
    .eq('event_type', event.eventType)
    .eq('is_active', true)
    .order('priority')

  if (error) throw error

  const results = []
  for (const rule of rules ?? []) {
    const conditions = rule.conditions as { operator?: 'AND' | 'OR'; rules?: import('../types').AutomationCondition[] }
    const payload = { ...event.payload, entityType: event.entityType, entityId: event.entityId }

    if (!evaluateConditions(conditions, payload)) continue

    const actions = (rule.actions ?? []) as Array<{ type: string; config?: Record<string, unknown> }>
    const executed = []

    for (const action of actions) {
      try {
        const result = await executeAction(action, event)
        executed.push(result)
      } catch (err) {
        executed.push({ action: action.type, error: String(err) })
      }
    }

    await client.from('automation_runs').insert({
      company_id: event.companyId,
      rule_id: rule.id,
      event_type: event.eventType,
      event_payload: payload,
      status: executed.some((e) => 'error' in e) ? 'PARTIAL' : 'SUCCESS',
      actions_executed: executed,
    })

    results.push({ ruleId: rule.id, ruleName: rule.name, executed })
  }

  return results
}

export async function emitPlatformEvent(event: PlatformEvent) {
  const results = await executeAutomationRules(event)

  const { triggerWebhook } = await import('../webhooks/delivery')
  await triggerWebhook({
    companyId: event.companyId,
    eventType: event.eventType,
    payload: event.payload ?? {},
  }).catch(() => null)

  return results
}
