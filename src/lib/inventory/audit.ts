import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function logInventoryAudit(input: {
  companyId: string
  action: string
  entityType: string
  entityId?: string | null
  inventoryItemId?: string | null
  warehouseId?: string | null
  userId?: string | null
  reason?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
}): Promise<void> {
  const client = createAdminClient()
  const { error } = await client.from('inventory_audit_logs').insert({
    company_id: input.companyId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    inventory_item_id: input.inventoryItemId ?? null,
    warehouse_id: input.warehouseId ?? null,
    user_id: input.userId ?? null,
    reason: input.reason ?? null,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
  })
  if (error) throw error
}
