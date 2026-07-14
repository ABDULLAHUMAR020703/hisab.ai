import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export interface PostingAuditInput {
  action: string
  entityType: string
  entityId?: string | null
  userId?: string | null
  companyId?: string
  reason?: string | null
  ipAddress?: string | null
  branchId?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
}

export async function logPostingAudit(input: PostingAuditInput): Promise<void> {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { error } = await client.from('audit_logs').insert({
    company_id: companyId,
    user_id: input.userId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    reason: input.reason ?? null,
    ip_address: input.ipAddress ?? null,
    branch_id: input.branchId ?? null,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
    details: {
      immutable: true,
      recordedAt: new Date().toISOString(),
    },
  })

  if (error) throw error
}

export function extractClientIp(request?: Request): string | null {
  if (!request) return null
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}
