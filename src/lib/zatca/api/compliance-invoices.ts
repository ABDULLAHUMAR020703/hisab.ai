import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { buildBasicAuthHeader } from '../signature/certificate'
import {
  getDecryptedBinarySecurityToken,
  getDecryptedCertificate,
  getDecryptedSecret,
} from '../onboarding/credential-store'
import { isMockSubmission, normalizeInvoiceHashForApi, resolveApiPath, type ZatcaApiResponseBody } from './client'
import { postZatcaJson, zatcaResponseMessage } from './http-client'

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

async function buildComplianceAuthHeaders(environment: ZatcaEnvironment) {
  const certificatePem = await getDecryptedCertificate(environment)
  if (!certificatePem) {
    throw new Error('Compliance certificate required for compliance invoice checks')
  }
  const secret = await getDecryptedSecret(environment)
  if (!secret) {
    throw new Error('Compliance secret required for compliance invoice checks')
  }
  const csidToken = await getDecryptedBinarySecurityToken(environment) ?? pemToBase64Der(certificatePem)
  return {
    Authorization: buildBasicAuthHeader(csidToken, secret),
    Accept: 'application/json',
    'Accept-Version': 'V2',
    'Accept-Language': 'en',
  }
}

export interface ComplianceInvoiceSubmissionInput {
  environment: ZatcaEnvironment
  invoiceHash: string
  uuid: string
  signedXml: string
}

export interface ComplianceInvoiceSubmissionResult {
  requestId: string
  validationStatus: string
  responseMessage: string
  rawResponse: ZatcaApiResponseBody
  submittedAt: Date
  responseCode: string
  warningCount: number
  errorCount: number
}

function mockComplianceInvoiceResponse(
  input: ComplianceInvoiceSubmissionInput,
): ComplianceInvoiceSubmissionResult {
  return {
    requestId: `MOCK-CMP-INV-${Date.now()}`,
    validationStatus: 'PASS',
    responseMessage: 'Mock compliance invoice check passed',
      rawResponse: {
        validationResults: { status: 'PASS' },
        requestID: `MOCK-CMP-INV-${Date.now()}`,
      },
      submittedAt: new Date(),
      responseCode: 'PASS',
      warningCount: 0,
      errorCount: 0,
  }
}

/**
 * Submits a signed invoice to ZATCA compliance checks (required before Production CSID).
 * @see ZATCA Fatoora Portal — /compliance/invoices
 */
export async function submitComplianceInvoice(
  input: ComplianceInvoiceSubmissionInput,
): Promise<ComplianceInvoiceSubmissionResult> {
  if (isMockSubmission()) {
    return mockComplianceInvoiceResponse(input)
  }

  const url = resolveApiPath(input.environment, '/compliance/invoices')
  const headers = await buildComplianceAuthHeaders(input.environment)
  const invoiceBase64 = Buffer.from(input.signedXml, 'utf8').toString('base64')

  console.log('[ZATCA] Compliance invoice request started', {
    endpoint: '/compliance/invoices',
    environment: input.environment,
    uuid: input.uuid,
    invoiceHashPrefix: normalizeInvoiceHashForApi(input.invoiceHash).slice(0, 12),
    invoiceBytes: invoiceBase64.length,
  })

  const response = await postZatcaJson({
    environment: input.environment,
    endpoint: '/compliance/invoices',
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

  console.log('[ZATCA] Compliance invoice response received', {
    endpoint: '/compliance/invoices',
    environment: input.environment,
    status: response.status,
    ok: response.ok,
    durationMs: response.durationMs,
    requestId: response.requestId || body.requestID || null,
    validationStatus: body.validationResults?.status ?? null,
    errorCode: body.errors?.[0]?.code ?? body.validationResults?.errorMessages?.[0]?.code ?? null,
  })

  if (!response.ok) {
    const alreadyCompleted = response.status === 406
      && body.validationResults?.errorMessages?.some((m) => m.code === 'Submitted before')
    if (alreadyCompleted) {
      return {
        requestId: response.requestId || body.requestID || '',
        validationStatus: 'PASS',
        responseMessage: 'Compliance check already completed for this invoice type',
        rawResponse: body,
        submittedAt: new Date(),
        responseCode: 'PASS',
        warningCount: response.warningCount,
        errorCount: 0,
      }
    }
    throw new Error(zatcaResponseMessage(body, `Compliance invoice check failed (${response.status})`))
  }

  const validationStatus = body.validationResults?.status ?? 'PASS'

  return {
    requestId: response.requestId || body.requestID || '',
    validationStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? validationStatus,
    rawResponse: body,
    submittedAt: new Date(),
    responseCode: validationStatus,
    warningCount: response.warningCount,
    errorCount: response.errorCount,
  }
}
