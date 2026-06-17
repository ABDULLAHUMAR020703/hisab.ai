import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import { buildBasicAuthHeader } from '../signature/certificate'
import { getCredential, getDecryptedSecret } from '../onboarding/credential-store'
import { isMockSubmission, resolveApiPath, type ZatcaApiResponseBody } from './client'

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

async function buildComplianceAuthHeaders(environment: ZatcaEnvironment) {
  const cred = await getCredential(environment)
  if (!cred?.certificate) {
    throw new Error('Compliance certificate required for compliance invoice checks')
  }
  const secret = await getDecryptedSecret(environment)
  if (!secret) {
    throw new Error('Compliance secret required for compliance invoice checks')
  }
  const csidToken = pemToBase64Der(cred.certificate)
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
      ?? `Compliance invoice check failed (${response.status})`
    throw new Error(message)
  }

  const validationStatus = body.validationResults?.status ?? 'PASS'

  return {
    requestId: body.requestID ?? '',
    validationStatus,
    responseMessage: body.validationResults?.infoMessages?.[0]?.message ?? validationStatus,
    rawResponse: body,
    submittedAt: new Date(),
  }
}
