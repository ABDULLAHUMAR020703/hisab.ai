import 'server-only'
import type { InvoiceType, ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { resolveInvoiceTypeCodeName } from '../constants'
import { resolveZatcaInvoiceTypeCodeName } from '../classification'
import { getCredential } from '../onboarding/credential-store'
import { loadInvoiceForZatca } from '../persistence'
import { TERMINAL_ZATCA_STATUSES, type InvoiceResponseView, type InvoiceStatusView, resolveSubmissionRoute } from './types'

export async function getInvoiceZatcaStatus(invoiceId: string): Promise<InvoiceStatusView | null> {
  const invoice = await loadInvoiceForZatca(invoiceId)
  if (!invoice) return null

  const settings = await getSettingsRepository().findFirst()
  const cred = settings ? await getCredential(settings.zatcaEnvironment) : null

  const hasCredentials = Boolean(
    cred?.certificate
      || cred?.certificateEnc
      || cred?.productionCertificate
      || cred?.productionCertificateEnc,
  )
  const canSubmit = Boolean(
    settings?.zatcaEnabled
    && hasCredentials
    && !TERMINAL_ZATCA_STATUSES.includes(invoice.zatcaStatus as ZatcaInvoiceStatus)
    && invoice.zatcaStatus !== 'PENDING',
  )

  const environment = settings?.zatcaEnvironment ?? 'SANDBOX'
  const resolvedType = invoice.invoiceType as InvoiceType
  const codeName = resolveZatcaInvoiceTypeCodeName({
    invoiceType: resolvedType,
    customer: invoice.customer ? { taxId: (invoice.customer as { taxId?: string | null }).taxId } : undefined,
    referencedSourceInvoiceType: invoice.referencedInvoiceType,
  })
  const submissionRoute = invoice.zatcaStatus === 'DRAFT'
    ? null
    : resolveSubmissionRoute(resolvedType, environment, resolveInvoiceTypeCodeName({
      invoiceType: resolvedType,
      invoiceTypeCodeNameOverride: codeName,
    }))

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    zatcaStatus: invoice.zatcaStatus as ZatcaInvoiceStatus,
    requestId: invoice.zatcaRequestId,
    globalTransactionId: invoice.zatcaGlobalTransactionId,
    responseCode: invoice.zatcaResponseCode,
    responseMessage: invoice.zatcaResponseMessage,
    clearanceStatus: invoice.clearanceStatus,
    submittedAt: invoice.zatcaSubmissionDate?.toISOString() ?? null,
    environment,
    submissionRoute,
    canSubmit,
  }
}

export async function getInvoiceZatcaResponse(invoiceId: string): Promise<InvoiceResponseView | null> {
  const invoice = await loadInvoiceForZatca(invoiceId)
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
    zatcaStatus: invoice.zatcaStatus as ZatcaInvoiceStatus,
    requestId: invoice.zatcaRequestId,
    responseCode: invoice.zatcaResponseCode,
    responseMessage: invoice.zatcaResponseMessage,
    submittedAt: invoice.zatcaSubmissionDate?.toISOString() ?? null,
    clearanceStatus: invoice.clearanceStatus,
    zatcaResponse,
    hasClearedPayload: Boolean(invoice.clearedInvoicePayload),
  }
}
