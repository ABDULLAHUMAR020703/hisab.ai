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

export interface ReportingSubmissionInput {
  environment: ZatcaEnvironment
  invoiceHash: string
  uuid: string
  signedXml: string
  invoiceId?: string
}

export interface ReportingSubmissionResult {
  requestId: string | null
  reportingStatus: string
  responseCode: string
  responseMessage: string
  rawResponse: ZatcaApiResponseBody
  submittedAt: Date
  warningCount: number
  errorCount: number
}

function mockReportingResponse(input: ReportingSubmissionInput): ReportingSubmissionResult {
  return {
    requestId: null,
    reportingStatus: 'REPORTED',
    responseCode: 'REPORTED',
    responseMessage: 'Mock reporting submission accepted',
    rawResponse: {
      validationResults: { status: 'PASS' },
      reportingStatus: 'REPORTED',
      mock: true,
    },
    submittedAt: new Date(),
    warningCount: 0,
    errorCount: 0,
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

  const response = await postZatcaJson({
    environment: input.environment,
    endpoint: '/invoices/reporting/single',
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
    throw new Error(zatcaResponseMessage(body, `Reporting submission failed (${response.status})`))
  }

  const reportingStatus = body.reportingStatus ?? body.validationResults?.status ?? 'REPORTED'

  return {
    requestId: response.requestId || body.requestID || null,
    reportingStatus,
    responseCode: reportingStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? reportingStatus,
    rawResponse: body,
    submittedAt: new Date(),
    warningCount: response.warningCount,
    errorCount: response.errorCount,
  }
}
