import 'server-only'
import { prisma } from '@/lib/prisma'

export type ZatcaAuditAction =
  | 'CSR_GENERATED'
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
  return prisma.zatcaAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
