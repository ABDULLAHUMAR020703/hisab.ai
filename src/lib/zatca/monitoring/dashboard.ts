import 'server-only'
import type { ZatcaInvoiceStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface ZatcaDashboardStats {
  submitted: number
  cleared: number
  reported: number
  failed: number
  pending: number
}

export interface ZatcaRecentActivity {
  id: string
  invoiceNo: string
  invoiceType: string
  zatcaStatus: ZatcaInvoiceStatus
  requestId: string | null
  submittedAt: string | null
  responseMessage: string | null
}

export async function getZatcaDashboardStats(): Promise<ZatcaDashboardStats> {
  const [cleared, reported, failed, pending, submitted] = await Promise.all([
    prisma.invoice.count({ where: { zatcaStatus: 'CLEARED' } }),
    prisma.invoice.count({ where: { zatcaStatus: 'REPORTED' } }),
    prisma.invoice.count({ where: { zatcaStatus: 'FAILED' } }),
    prisma.invoice.count({ where: { zatcaStatus: 'PENDING' } }),
    prisma.invoice.count({
      where: { zatcaStatus: { in: ['SUBMITTED', 'CLEARED', 'REPORTED'] } },
    }),
  ])

  return { submitted, cleared, reported, failed, pending }
}

export async function getZatcaRecentActivity(limit = 20): Promise<ZatcaRecentActivity[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      zatcaStatus: { not: 'DRAFT' },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      invoiceNo: true,
      invoiceType: true,
      zatcaStatus: true,
      zatcaRequestId: true,
      zatcaSubmissionDate: true,
      zatcaResponseMessage: true,
    },
  })

  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceType: inv.invoiceType,
    zatcaStatus: inv.zatcaStatus,
    requestId: inv.zatcaRequestId,
    submittedAt: inv.zatcaSubmissionDate?.toISOString() ?? null,
    responseMessage: inv.zatcaResponseMessage,
  }))
}
