import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import {
  buildZatcaAuthHeaders,
  isMockSubmission,
  resolveApiPath,
  type ZatcaApiResponseBody,
} from './client'

export interface ClearanceSubmissionInput {
  environment: ZatcaEnvironment
  invoiceHash: string
  uuid: string
  signedXml: string
}

export interface ClearanceSubmissionResult {
  requestId: string
  clearanceStatus: string
  responseCode: string
  responseMessage: string
  clearedInvoice?: string
  rawResponse: ZatcaApiResponseBody
  submittedAt: Date
}

function mockClearanceResponse(input: ClearanceSubmissionInput): ClearanceSubmissionResult {
  const cleared = Buffer.from(input.signedXml, 'utf8').toString('base64')
  return {
    requestId: `MOCK-CLR-${Date.now()}`,
    clearanceStatus: 'CLEARED',
    responseCode: 'CLEARED',
    responseMessage: 'Mock clearance submission accepted',
    clearedInvoice: cleared,
    rawResponse: {
      validationResults: { status: 'PASS' },
      clearanceStatus: 'CLEARED',
      clearedInvoice: cleared,
      requestID: `MOCK-CLR-${Date.now()}`,
    },
    submittedAt: new Date(),
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      invoiceHash: input.invoiceHash,
      uuid: input.uuid,
      invoice: invoiceBase64,
    }),
  })

  const body = (await response.json().catch(() => ({}))) as ZatcaApiResponseBody

  if (!response.ok) {
    const message = body.errors?.[0]?.message
      ?? body.validationResults?.errorMessages?.[0]?.message
      ?? `Clearance submission failed (${response.status})`
    throw new Error(message)
  }

  const clearanceStatus = body.clearanceStatus ?? body.validationResults?.status ?? 'CLEARED'

  return {
    requestId: body.requestID ?? '',
    clearanceStatus,
    responseCode: clearanceStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? clearanceStatus,
    clearedInvoice: body.clearedInvoice,
    rawResponse: body,
    submittedAt: new Date(),
  }
}
