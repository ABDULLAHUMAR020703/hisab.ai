import 'server-only'
import { prisma } from '@/lib/prisma'
import { getCredential } from '../onboarding/credential-store'
import { TERMINAL_ZATCA_STATUSES, type InvoiceResponseView, type InvoiceStatusView } from './types'

export async function getInvoiceZatcaStatus(invoiceId: string): Promise<InvoiceStatusView | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) return null

  const settings = await prisma.companySettings.findFirst()
  const cred = settings ? await getCredential(settings.zatcaEnvironment) : null

  const hasCredentials = Boolean(cred?.certificate || cred?.productionCertificate)
  const canSubmit = Boolean(
    settings?.zatcaEnabled
    && hasCredentials
    && !TERMINAL_ZATCA_STATUSES.includes(invoice.zatcaStatus)
    && invoice.zatcaStatus !== 'PENDING',
  )

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    zatcaStatus: invoice.zatcaStatus,
    requestId: invoice.zatcaRequestId,
    responseCode: invoice.zatcaResponseCode,
    responseMessage: invoice.zatcaResponseMessage,
    clearanceStatus: invoice.clearanceStatus,
    submittedAt: invoice.zatcaSubmissionDate?.toISOString() ?? null,
    canSubmit,
  }
}

export async function getInvoiceZatcaResponse(invoiceId: string): Promise<InvoiceResponseView | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) return null

  let zatcaResponse: Record<string, unknown> | null = null
  if (invoice.zatcaResponsePayload) {
    try {
      zatcaResponse = JSON.parse(invoice.zatcaResponsePayload) as Record<string, unknown>
    } catch {
      zatcaResponse = null
    }
  }

  return {
    invoiceId: invoice.id,
    zatcaStatus: invoice.zatcaStatus,
    requestId: invoice.zatcaRequestId,
    responseCode: invoice.zatcaResponseCode,
    responseMessage: invoice.zatcaResponseMessage,
    submittedAt: invoice.zatcaSubmissionDate?.toISOString() ?? null,
    clearanceStatus: invoice.clearanceStatus,
    zatcaResponse,
    hasClearedPayload: Boolean(invoice.clearedInvoicePayload),
  }
}
