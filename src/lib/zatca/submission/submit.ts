import 'server-only'
import type { InvoiceType, ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { logZatcaAudit } from '../audit/logger'
import { submitClearanceInvoice } from '../api/clearance'
import { submitReportingInvoice } from '../api/reporting'
import { ZatcaError, mapToZatcaError } from '../errors'
import { syncInputTotalsFromDocument } from '../generate'
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
import {
  extractDocumentMonetarySnapshot,
  extractXmlMonetarySnapshot,
} from '../validation/monetary'
import { verifyPihForInvoice } from '../pih-chain'
import { resolveInvoiceTypeCodeName } from '../constants'
import { getSubmissionRoute } from './router'
import { TERMINAL_ZATCA_STATUSES, type InvoiceSubmissionResult } from './types'

export interface SubmitAuditContext {
  userId?: string
  userName?: string | null
}

function assertMonetaryPipelineIntegrity(args: {
  document: ReturnType<typeof extractDocumentMonetarySnapshot>
  xml: ReturnType<typeof extractXmlMonetarySnapshot>
  signedXml: ReturnType<typeof extractXmlMonetarySnapshot>
}) {
  const keys = [
    'lineExtensionAmount',
    'taxExclusiveAmount',
    'taxAmount',
    'taxInclusiveAmount',
    'payableAmount',
  ] as const

  for (const key of keys) {
    const docVal = args.document[key]
    const xmlVal = args.xml[key]
    const signedVal = args.signedXml[key]
    if (xmlVal == null || signedVal == null) {
      throw new ZatcaError(
        'VALIDATION_FAILED',
        `Missing monetary field ${key} in generated/signed XML`,
      )
    }
    if (Math.abs(docVal - xmlVal) > 0.001 || Math.abs(xmlVal - signedVal) > 0.001) {
      throw new ZatcaError(
        'VALIDATION_FAILED',
        `Monetary field ${key} diverged across document/XML/signed XML (${docVal} / ${xmlVal} / ${signedVal})`,
      )
    }
  }
}

async function recordFailure(
  invoiceId: string,
  zatcaError: ZatcaError,
  auditContext?: SubmitAuditContext,
  companyName?: string,
) {
  // Do not clear signedXml / pre-submission artifacts — failures must remain inspectable.
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
  if (zatcaStatus === 'PENDING') {
    throw new ZatcaError('SUBMISSION_IN_PROGRESS', 'Invoice submission is already in progress. Wait and retry if it does not complete.')
  }
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
  const wasRetry = invoice.zatcaStatus === 'FAILED'

  const pihCheck = await verifyPihForInvoice(invoiceId)
  if (!pihCheck.valid) {
    const message = pihCheck.issues.map((issue) => issue.message).join(' ')
    await logZatcaAudit({
      action: 'PIH_CHAIN_WARNING',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName,
      invoiceId,
      metadata: { issues: pihCheck.issues },
    })
    throw new ZatcaError('PIH_CHAIN_BROKEN', `Invoice hash chain is broken. ${message}`)
  }

  if (wasRetry) {
    await logZatcaAudit({
      action: 'SUBMISSION_RETRY',
      result: 'SUCCESS',
      message: 'Retrying failed ZATCA submission for the same invoice',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName,
      invoiceId,
      metadata: { environment },
    })
  }

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

    // Align header totals with XML pipeline (single monetary source of truth)
    const input = syncInputTotalsFromDocument(loaded.input, processed.document)

    const fullValidation = validateFullSubmissionPipeline(
      input,
      processed.validation,
      processed.document,
    )
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
    const typeCodeName = resolveInvoiceTypeCodeName(loaded.input)
    const route = getSubmissionRoute(loaded.input.invoiceType as InvoiceType, environment, typeCodeName)
    const submittedAt = new Date()
    const submissionHash = invoiceHashHex
    const invoiceBase64 = Buffer.from(signedXml, 'utf8').toString('base64')

    const documentMonetary = extractDocumentMonetarySnapshot(processed.document)
    const xmlMonetary = extractXmlMonetarySnapshot(processed.xml)
    const signedMonetary = extractXmlMonetarySnapshot(signedXml)
    assertMonetaryPipelineIntegrity({
      document: documentMonetary,
      xml: xmlMonetary,
      signedXml: signedMonetary,
    })

    const submissionRequest = {
      invoiceHash: submissionHash,
      uuid,
      invoice: invoiceBase64,
    }

    // Persist generated/signed XML + payload BEFORE ZATCA HTTP so failures remain inspectable
    await updateInvoiceZatcaFields(invoiceId, {
      signedXml,
      zatcaResponsePayload: JSON.stringify({
        preSubmission: {
          invoiceId,
          profileId: processed.document.profileId,
          invoiceTypeCode: processed.document.invoiceTypeCode,
          invoiceTypeCodeName: processed.document.invoiceTypeCodeName,
          submissionRoute: route,
          monetary: {
            document: documentMonetary,
            generatedXml: xmlMonetary,
            signedXml: signedMonetary,
            httpPayload: {
              taxExclusiveAmount: documentMonetary.taxExclusiveAmount,
              taxAmount: documentMonetary.taxAmount,
              taxInclusiveAmount: documentMonetary.taxInclusiveAmount,
              payableAmount: documentMonetary.payableAmount,
              lineExtensionAmount: documentMonetary.lineExtensionAmount,
            },
          },
          generatedXml: processed.xml,
          request: submissionRequest,
        },
      }),
    })

    console.info(
      '[zatca-submit]',
      JSON.stringify({
        invoiceId,
        profileId: processed.document.profileId,
        invoiceTypeCode: processed.document.invoiceTypeCode,
        submissionRoute: route,
        xmlTotals: xmlMonetary,
        signedXmlTotals: signedMonetary,
        httpPayloadTotals: documentMonetary,
        request: {
          invoiceHash: submissionHash,
          uuid,
          invoiceBase64Length: invoiceBase64.length,
        },
      }),
    )

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
      console.info(
        '[zatca-submit-response]',
        JSON.stringify({
          invoiceId,
          submissionRoute: route,
          error: apiError instanceof Error ? apiError.message : String(apiError),
        }),
      )
      throw mapToZatcaError(apiError)
    }

    console.info(
      '[zatca-submit-response]',
      JSON.stringify({
        invoiceId,
        submissionRoute: route,
        requestId,
        responseCode,
        zatcaStatus,
        rawResponse,
      }),
    )

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
      zatcaResponsePayload: JSON.stringify({
        preSubmission: {
          invoiceId,
          profileId: processed.document.profileId,
          invoiceTypeCode: processed.document.invoiceTypeCode,
          invoiceTypeCodeName: processed.document.invoiceTypeCodeName,
          submissionRoute: route,
          monetary: {
            document: documentMonetary,
            generatedXml: xmlMonetary,
            signedXml: signedMonetary,
          },
          generatedXml: processed.xml,
          request: submissionRequest,
        },
        response: rawResponse,
      }),
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
