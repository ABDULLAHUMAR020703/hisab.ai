import 'server-only'
import { isUuid, resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { prisma } from '@/lib/prisma'
import { isSupabaseEnabled } from '@/lib/supabase/env'

export type ZatcaAuditAction =
  | 'CSR_GENERATED'
  | 'ONBOARDING_STARTED'
  | 'COMPLIANCE_CSID_REQUESTED'
  | 'CREDENTIALS_STORED'
  | 'COMPLIANCE_CHECKS_STARTED'
  | 'COMPLIANCE_CHECK_SCENARIO'
  | 'COMPLIANCE_CHECKS_COMPLETED'
  | 'ONBOARDING_COMPLETED'
  | 'ONBOARDING_FAILED'
  | 'COMPLIANCE_CSID_ISSUED'
  | 'PRODUCTION_CSID_ISSUED'
  | 'INVOICE_SUBMITTED'
  | 'INVOICE_CLEARED'
  | 'INVOICE_REPORTED'
  | 'SUBMISSION_FAILED'
  | 'SANDBOX_TEST_RUN'

export interface ZatcaAuditInput {
  action: ZatcaAuditAction
  result: 'SUCCESS' | 'FAILED'
  message?: string
  userId?: string | null
  userName?: string | null
  companyName?: string | null
  invoiceId?: string | null
  metadata?: Record<string, unknown>
}

export async function logZatcaAudit(input: ZatcaAuditInput) {
  if (isSupabaseEnabled()) {
    const companyId = await resolveCompanyId()
    const { data, error } = await supabaseDb()
      .from('zatca_audit_logs')
      .insert({
        company_id: companyId,
        action: input.action,
        result: input.result,
        message: input.message ?? null,
        user_id: input.userId && isUuid(input.userId) ? input.userId : null,
        user_name: input.userName ?? null,
        company_name: input.companyName ?? null,
        invoice_id: input.invoiceId && isUuid(input.invoiceId) ? input.invoiceId : null,
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single()

    if (error) throw error
    return data
  }

  return prisma.zatcaAuditLog.create({
    data: {
      action: input.action,
      result: input.result,
      message: input.message ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      companyName: input.companyName ?? null,
      invoiceId: input.invoiceId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  })
}

export async function getRecentAuditLogs(limit = 50) {
  const { getAuditRepository } = await import('@/lib/db/provider')
  return getAuditRepository().findRecent(limit)
}
