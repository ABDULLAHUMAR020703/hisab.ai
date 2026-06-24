import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import {
  buildZatcaAuthHeaders,
  isMockSubmission,
  normalizeInvoiceHashForApi,
  resolveApiPath,
  type ZatcaApiResponseBody,
} from './client'
import { postZatcaJson, zatcaResponseMessage } from './http-client'
import { resolveZatcaTraceId } from './api-log'

export interface ClearanceSubmissionInput {
  environment: ZatcaEnvironment
  invoiceHash: string
  uuid: string
  signedXml: string
  invoiceId?: string
}

export interface ClearanceSubmissionResult {
  requestId: string | null
  globalTransactionId: string | null
  clearanceStatus: string
  responseCode: string
  responseMessage: string
  clearedInvoice?: string
  rawResponse: ZatcaApiResponseBody
  submittedAt: Date
  warningCount: number
  errorCount: number
}

function mockClearanceResponse(input: ClearanceSubmissionInput): ClearanceSubmissionResult {
  const cleared = Buffer.from(input.signedXml, 'utf8').toString('base64')
  return {
    requestId: null,
    globalTransactionId: null,
    clearanceStatus: 'CLEARED',
    responseCode: 'CLEARED',
    responseMessage: 'Mock clearance submission accepted',
    clearedInvoice: cleared,
    rawResponse: {
      validationResults: { status: 'PASS' },
      clearanceStatus: 'CLEARED',
      clearedInvoice: cleared,
      mock: true,
    },
    submittedAt: new Date(),
    warningCount: 0,
    errorCount: 0,
  }
}

/**
 * Submits a signed invoice to ZATCA Clearance API (standard tax invoices).
 */
export async function submitClearanceInvoice(
  input: ClearanceSubmissionInput,
): Promise<ClearanceSubmissionResult> {
  if (isMockSubmission()) {
    return mockClearanceResponse(input)
  }

  const url = resolveApiPath(input.environment, '/invoices/clearance/single')
  const headers = await buildZatcaAuthHeaders(input.environment)
  const invoiceBase64 = Buffer.from(input.signedXml, 'utf8').toString('base64')

  const response = await postZatcaJson({
    environment: input.environment,
    endpoint: '/invoices/clearance/single',
    invoiceId: input.invoiceId,
    url,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: {
      invoiceHash: normalizeInvoiceHashForApi(input.invoiceHash),
      uuid: input.uuid,
      invoice: invoiceBase64,
    },
  })

  const body = response.body

  if (!response.ok) {
    throw new Error(zatcaResponseMessage(body, `Clearance submission failed (${response.status})`))
  }

  const clearanceStatus = body.clearanceStatus ?? body.validationResults?.status ?? 'CLEARED'

  return {
    requestId: resolveZatcaTraceId(response.requestId, response.globalTransactionId) || null,
    globalTransactionId: response.globalTransactionId || null,
    clearanceStatus,
    responseCode: clearanceStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? clearanceStatus,
    clearedInvoice: body.clearedInvoice,
    rawResponse: body,
    submittedAt: new Date(),
    warningCount: response.warningCount,
    errorCount: response.errorCount,
  }
}
