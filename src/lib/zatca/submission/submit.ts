import 'server-only'
import type { InvoiceType, ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { logZatcaAudit } from '../audit/logger'
import { submitClearanceInvoice } from '../api/clearance'
import { submitReportingInvoice } from '../api/reporting'
import { ZatcaError, mapToZatcaError } from '../errors'
import { signAndEmbedPhase2Qr } from '../invoice-signing'
import { loadZatcaInvoiceById, processZatcaInvoice } from '../invoice-service'
import { loadInvoiceForZatca, updateInvoiceZatcaFields } from '../persistence'
import { loadSigningCredentials } from '../signature/certificate'
import { verifyInvoiceSignature } from '../signature/signer'
import { getCredential } from '../onboarding/credential-store'
import {
  validateFullSubmissionPipeline,
  validateSubmissionReadiness,
} from '../validation/hardening'
import { getSubmissionRoute } from './router'
import { TERMINAL_ZATCA_STATUSES, type InvoiceSubmissionResult } from './types'

export interface SubmitAuditContext {
  userId?: string
  userName?: string | null
}

async function recordFailure(
  invoiceId: string,
  zatcaError: ZatcaError,
  auditContext?: SubmitAuditContext,
  companyName?: string,
) {
  await updateInvoiceZatcaFields(invoiceId, {
    zatcaStatus: 'FAILED',
    zatcaFailureCode: zatcaError.code,
    zatcaResponseMessage: zatcaError.diagnostic,
  })

  await logZatcaAudit({
    action: 'SUBMISSION_FAILED',
    result: 'FAILED',
    message: zatcaError.diagnostic,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: companyName ?? null,
    invoiceId,
    metadata: { code: zatcaError.code },
  })
}

async function assertSubmissionReady(invoiceId: string) {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new ZatcaError('VALIDATION_FAILED', 'Company settings not found')

  const invoice = await loadInvoiceForZatca(invoiceId)
  if (!invoice) throw new ZatcaError('INVOICE_NOT_FOUND', 'Invoice not found')

  const zatcaStatus = invoice.zatcaStatus as ZatcaInvoiceStatus
  if (TERMINAL_ZATCA_STATUSES.includes(zatcaStatus)) {
    throw new ZatcaError('ALREADY_SUBMITTED', `Invoice already submitted with status: ${invoice.zatcaStatus}`)
  }

  const cred = await getCredential(settings.zatcaEnvironment)
  const readiness = validateSubmissionReadiness({
    zatcaEnabled: settings.zatcaEnabled,
    hasCertificate: Boolean(cred?.certificateEnc || cred?.certificate || cred?.productionCertificateEnc || cred?.productionCertificate),
    environment: settings.zatcaEnvironment,
  })

  if (!readiness.valid) {
    throw new ZatcaError(
      'MISSING_CREDENTIALS',
      readiness.errors.map((e) => e.message).join('; '),
    )
  }

  return { settings, invoice, companyName: settings.companyName }
}

/**
 * Full ZATCA submission workflow with hardened validation, audit logging, and failure diagnostics.
 */
export async function submitInvoice(
  invoiceId: string,
  auditContext?: SubmitAuditContext,
): Promise<InvoiceSubmissionResult> {
  const { settings, invoice, companyName } = await assertSubmissionReady(invoiceId)
  const environment = settings.zatcaEnvironment

  await updateInvoiceZatcaFields(invoiceId, {
    zatcaStatus: 'PENDING',
    zatcaFailureCode: null,
  })

  try {
    const processed = await processZatcaInvoice(invoiceId, { persistHash: true })
    if (!processed?.validation.valid) {
      throw new ZatcaError('VALIDATION_FAILED', 'ZATCA validation failed before submission.')
    }

    const loaded = await loadZatcaInvoiceById(invoiceId)
    if (!loaded) throw new ZatcaError('INVOICE_NOT_FOUND', 'Invoice not found')

    const input = loaded.input

    const fullValidation = validateFullSubmissionPipeline(input, processed.validation)
    if (!fullValidation.valid) {
      throw new ZatcaError(
        'VALIDATION_FAILED',
        fullValidation.errors.map((e) => e.message).join('; '),
      )
    }

    let signingCreds
    try {
      signingCreds = await loadSigningCredentials(environment)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load signing credentials'
      throw new ZatcaError('MISSING_CREDENTIALS', message)
    }

    const { signedXml, invoiceHashHex } = signAndEmbedPhase2Qr(
      processed.xml,
      input,
      signingCreds.certificatePem,
      signingCreds.privateKeyPem,
    )

    if (!signedXml.includes('ds:Signature')) {
      throw new ZatcaError('INVALID_SIGNATURE', 'Signed XML missing signature block')
    }

    if (!verifyInvoiceSignature(signedXml, signingCreds.certificatePem)) {
      throw new ZatcaError('INVALID_SIGNATURE', 'Invoice signature verification failed')
    }

    const uuid = processed.document.uuid
    const route = getSubmissionRoute(invoice.invoiceType as InvoiceType, environment)
    const submittedAt = new Date()
    const submissionHash = invoiceHashHex

    let zatcaStatus: ZatcaInvoiceStatus = 'SUBMITTED'
    let requestId: string | null = null
    let globalTransactionId: string | null = null
    let responseCode: string | null = null
    let responseMessage: string | null = null
    let clearanceStatus: string | null = null
    let clearedInvoicePayload: string | null = null
    let rawResponse: Record<string, unknown> = {}
    let warningCount = 0
    let errorCount = 0

    try {
      if (route === 'clearance') {
        const result = await submitClearanceInvoice({
          environment,
          invoiceHash: submissionHash,
          uuid,
          signedXml,
          invoiceId,
        })
        requestId = result.requestId
        globalTransactionId = result.globalTransactionId
        responseCode = result.responseCode
        responseMessage = result.responseMessage
        clearanceStatus = result.clearanceStatus
        clearedInvoicePayload = result.clearedInvoice ?? null
        zatcaStatus = result.clearanceStatus === 'CLEARED' ? 'CLEARED' : 'SUBMITTED'
        rawResponse = result.rawResponse as Record<string, unknown>
        warningCount = result.warningCount
        errorCount = result.errorCount
      } else {
        const result = await submitReportingInvoice({
          environment,
          invoiceHash: submissionHash,
          uuid,
          signedXml,
          invoiceId,
        })
        requestId = result.requestId
        globalTransactionId = result.globalTransactionId
        responseCode = result.responseCode
        responseMessage = result.responseMessage
        zatcaStatus = result.reportingStatus === 'REPORTED' ? 'REPORTED' : 'SUBMITTED'
        rawResponse = result.rawResponse as Record<string, unknown>
        warningCount = result.warningCount
        errorCount = result.errorCount
      }
    } catch (apiError) {
      throw mapToZatcaError(apiError)
    }

    await updateInvoiceZatcaFields(invoiceId, {
        zatcaStatus,
        zatcaRequestId: requestId,
        zatcaGlobalTransactionId: globalTransactionId,
        zatcaResponseCode: responseCode,
        zatcaResponseMessage: responseMessage,
        zatcaWarningCount: warningCount,
        zatcaErrorCount: errorCount,
        zatcaFailureCode: null,
        clearanceStatus,
        clearedInvoicePayload,
        signedXml,
        zatcaResponsePayload: JSON.stringify(rawResponse),
        zatcaSubmissionDate: submittedAt,
    })

    await logZatcaAudit({
      action: 'INVOICE_SUBMITTED',
      result: 'SUCCESS',
      message: `Submitted via ${route}`,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName,
      invoiceId,
      metadata: { route, requestId, globalTransactionId, zatcaStatus, warningCount, errorCount },
    })

    if (zatcaStatus === 'CLEARED') {
      await logZatcaAudit({
        action: 'INVOICE_CLEARED',
        result: 'SUCCESS',
        message: clearanceStatus ?? 'CLEARED',
        userId: auditContext?.userId,
        userName: auditContext?.userName,
        companyName,
        invoiceId,
        metadata: { requestId },
      })
    }

    if (zatcaStatus === 'REPORTED') {
      await logZatcaAudit({
        action: 'INVOICE_REPORTED',
        result: 'SUCCESS',
        message: responseMessage ?? 'REPORTED',
        userId: auditContext?.userId,
        userName: auditContext?.userName,
        companyName,
        invoiceId,
        metadata: { requestId },
      })
    }

    return {
      invoiceId,
      route,
      zatcaStatus,
      requestId,
      responseCode,
      responseMessage,
      submittedAt: submittedAt.toISOString(),
      environment,
    }
  } catch (error) {
    const zatcaError = mapToZatcaError(error)
    await recordFailure(invoiceId, zatcaError, auditContext, companyName)
    throw zatcaError
  }
}
