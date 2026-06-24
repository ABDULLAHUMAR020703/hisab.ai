import 'server-only'
import type { ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { prisma } from '@/lib/prisma'
import { getSettingsRepository } from '@/lib/db/provider'
import { getCertificateStatus } from '../onboarding/certificate-status'

export interface ZatcaDashboardStats {
  submitted: number
  cleared: number
  reported: number
  failed: number
  pending: number
  retrying: number
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

export interface ZatcaOperationalSummary {
  certificateStatus: Awaited<ReturnType<typeof getCertificateStatus>>
  topErrorCodes: Array<{ code: string; count: number }>
  recentRequestIds: Array<{ invoiceNo: string; requestId: string; status: ZatcaInvoiceStatus }>
  recentFailures: ZatcaRecentActivity[]
  environment: string
}

type ZatcaInvoiceActivityRow = {
  id: string
  invoiceNo: string
  invoiceType: string
  zatcaStatus: ZatcaInvoiceStatus
  zatcaRequestId: string | null
  zatcaSubmissionDate?: Date | null
  zatcaResponseMessage: string | null
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

  return { submitted, cleared, reported, failed, pending, retrying: 0 }
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

  return (invoices as ZatcaInvoiceActivityRow[]).map((inv: ZatcaInvoiceActivityRow) => ({
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceType: inv.invoiceType,
    zatcaStatus: inv.zatcaStatus,
    requestId: inv.zatcaRequestId,
    submittedAt: inv.zatcaSubmissionDate?.toISOString() ?? null,
    responseMessage: inv.zatcaResponseMessage,
  }))
}

export async function getZatcaOperationalSummary(): Promise<ZatcaOperationalSummary> {
  const settings = await getSettingsRepository().findFirst()
  const environment = settings?.zatcaEnvironment ?? 'SANDBOX'
  const [certificateStatus, invoices] = await Promise.all([
    getCertificateStatus(environment),
    prisma.invoice.findMany({
      where: { zatcaStatus: { not: 'DRAFT' } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        invoiceNo: true,
        invoiceType: true,
        zatcaStatus: true,
        zatcaRequestId: true,
        zatcaFailureCode: true,
        zatcaSubmissionDate: true,
        zatcaResponseMessage: true,
      },
    }),
  ])

  const errorCounts = new Map<string, number>()
  for (const invoice of invoices as Array<ZatcaInvoiceActivityRow & { zatcaFailureCode?: string | null }>) {
    if (invoice.zatcaFailureCode) {
      errorCounts.set(invoice.zatcaFailureCode, (errorCounts.get(invoice.zatcaFailureCode) ?? 0) + 1)
    }
  }

  const recentFailures = (invoices as Array<ZatcaInvoiceActivityRow>)
    .filter((invoice) => invoice.zatcaStatus === 'FAILED')
    .slice(0, 10)
    .map((invoice) => ({
      id: invoice.id ?? invoice.invoiceNo,
      invoiceNo: invoice.invoiceNo,
      invoiceType: invoice.invoiceType,
      zatcaStatus: invoice.zatcaStatus,
      requestId: invoice.zatcaRequestId,
      submittedAt: invoice.zatcaSubmissionDate?.toISOString() ?? null,
      responseMessage: invoice.zatcaResponseMessage,
    }))

  return {
    certificateStatus,
    topErrorCodes: [...errorCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    recentRequestIds: (invoices as Array<ZatcaInvoiceActivityRow>)
      .filter((invoice) => Boolean(invoice.zatcaRequestId))
      .slice(0, 10)
      .map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        requestId: invoice.zatcaRequestId!,
        status: invoice.zatcaStatus,
      })),
    recentFailures,
    environment,
  }
}
