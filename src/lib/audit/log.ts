import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export interface AuditLogInput {
  action: string
  entityType: string
  entityId?: string | null
  details?: Record<string, unknown> | null
  userId?: string | null
  companyId?: string
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { error } = await client.from('audit_logs').insert({
    company_id: companyId,
    user_id: input.userId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    details: input.details ?? null,
  })

  if (error) throw error
}
