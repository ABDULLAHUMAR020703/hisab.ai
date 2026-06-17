import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import {
  buildZatcaAuthHeaders,
  isMockSubmission,
  resolveApiPath,
  type ZatcaApiResponseBody,
} from './client'

export interface ReportingSubmissionInput {
  environment: ZatcaEnvironment
  invoiceHash: string
  uuid: string
  signedXml: string
}

export interface ReportingSubmissionResult {
  requestId: string
  reportingStatus: string
  responseCode: string
  responseMessage: string
  rawResponse: ZatcaApiResponseBody
  submittedAt: Date
}

function mockReportingResponse(input: ReportingSubmissionInput): ReportingSubmissionResult {
  return {
    requestId: `MOCK-RPT-${Date.now()}`,
    reportingStatus: 'REPORTED',
    responseCode: 'REPORTED',
    responseMessage: 'Mock reporting submission accepted',
    rawResponse: {
      validationResults: { status: 'PASS' },
      reportingStatus: 'REPORTED',
      requestID: `MOCK-RPT-${Date.now()}`,
    },
    submittedAt: new Date(),
  }
}

/**
 * Submits a signed invoice to ZATCA Reporting API (simplified, credit, debit).
 */
export async function submitReportingInvoice(
  input: ReportingSubmissionInput,
): Promise<ReportingSubmissionResult> {
  if (isMockSubmission()) {
    return mockReportingResponse(input)
  }

  const url = resolveApiPath(input.environment, '/invoices/reporting/single')
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
      ?? `Reporting submission failed (${response.status})`
    throw new Error(message)
  }

  const reportingStatus = body.reportingStatus ?? body.validationResults?.status ?? 'REPORTED'

  return {
    requestId: body.requestID ?? '',
    reportingStatus,
    responseCode: reportingStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? reportingStatus,
    rawResponse: body,
    submittedAt: new Date(),
  }
}
