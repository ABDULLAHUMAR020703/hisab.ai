import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { isMockOnboardingEnabled } from '../env-guard'
import type { ComplianceCsidRequest, ComplianceCsidResponse } from './types'
import {
  extractBodyRequestId,
  extractGlobalTransactionId,
  persistZatcaApiLog,
  resolveZatcaTraceId,
  sanitizeZatcaResponsePayload,
} from '../api/api-log'
import type { ZatcaApiResponseBody } from '../api/client'

const ZATCA_API_PATHS: Record<ZatcaEnvironment, string> = {
  SANDBOX: '/e-invoicing/simulation/compliance',
  PRODUCTION: '/e-invoicing/core/compliance',
}

export function getApiBaseUrl(): string {
  return process.env.ZATCA_API_BASE_URL ?? 'https://gw-fatoora.zatca.gov.sa'
}

function wrapCertificatePem(binarySecurityToken: string): string {
  // ZATCA's binarySecurityToken is base64 of the certificate's base64 DER body
  // (i.e. double-encoded). Decode one layer to recover the real PEM body before
  // wrapping; otherwise the resulting "certificate" cannot be parsed as X.509.
  let body = binarySecurityToken.trim()
  if (!/-----BEGIN/.test(body)) {
    try {
      const decoded = Buffer.from(body, 'base64').toString('utf8').trim()
      if (/^MII[A-Za-z0-9+/]/.test(decoded)) {
        body = decoded
      }
    } catch {
      // Keep the original token if it is not a second base64 layer.
    }
  }
  const lines = body.match(/.{1,64}/g) ?? [body]
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`
}

export function isMockMode(): boolean {
  return isMockOnboardingEnabled()
}

function mockComplianceResponse(request: ComplianceCsidRequest): ComplianceCsidResponse {
  const requestId = `MOCK-${Date.now()}`
  const token = Buffer.from(`MOCK-CSID-${request.environment}-${request.otp}`).toString('base64')
  return {
    requestId,
    dispositionMessage: 'ISSUED',
    binarySecurityToken: token,
    secret: `mock-secret-${request.otp}`,
    certificatePem: wrapCertificatePem(token),
  }
}

interface ZatcaComplianceApiResponse {
  requestID?: string
  dispositionMessage?: string
  binarySecurityToken?: string
  secret?: string
  errorCode?: string
  errorCategory?: string
  errorMessage?: string
  errors?: Array<{ message?: string; code?: string }> | null
}

function formatComplianceError(
  body: ZatcaComplianceApiResponse,
  status: number,
): string {
  const message = body.errorMessage
    ?? body.errors?.[0]?.message
    ?? body.dispositionMessage
    ?? `ZATCA compliance request failed (${status})`

  const category = body.errorCategory ?? body.errors?.[0]?.code
  if (category && !message.includes(category)) {
    return `${category}: ${message}`
  }

  return message
}

/**
 * Requests a Compliance CSID from ZATCA using OTP-based onboarding.
 * Set ZATCA_MOCK_ONBOARDING=true for local development without live API access.
 */
export async function requestComplianceCsid(
  request: ComplianceCsidRequest,
): Promise<ComplianceCsidResponse> {
  if (!request.otp?.trim()) {
    throw new Error('OTP is required for ZATCA compliance onboarding')
  }

  if (isMockMode()) {
    return mockComplianceResponse(request)
  }

  const url = `${getApiBaseUrl()}${ZATCA_API_PATHS[request.environment]}`
  const otp = request.otp.trim()
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Version': 'V2',
    OTP: otp,
  }
  const requestBody = JSON.stringify({ csr: request.csrBase64 })
  const requestStartedAt = Date.now()

  console.log('[ZATCA] Compliance CSID request started', {
    endpoint: ZATCA_API_PATHS[request.environment],
    environment: request.environment,
    csrBytes: Buffer.byteLength(request.csrBase64, 'utf8'),
    otpPresent: Boolean(otp),
  })

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: requestBody,
  })

  const rawText = await response.text()
  let body: ZatcaComplianceApiResponse = {}
  try {
    body = JSON.parse(rawText) as ZatcaComplianceApiResponse
  } catch {
    // non-JSON response
  }

  console.log('[ZATCA] Compliance CSID response received', {
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - requestStartedAt,
    requestId: body.requestID ?? null,
    globalTransactionId: extractGlobalTransactionId(response.headers) || null,
    dispositionMessage: body.dispositionMessage ?? null,
    hasBinarySecurityToken: Boolean(body.binarySecurityToken),
    hasSecret: Boolean(body.secret),
    errorCode: body.errorCode ?? body.errors?.[0]?.code ?? null,
  })

  const requestId = extractBodyRequestId(body as ZatcaApiResponseBody)
  const globalTransactionId = extractGlobalTransactionId(response.headers)
  const durationMs = Date.now() - requestStartedAt

  await persistZatcaApiLog({
    environment: request.environment,
    endpoint: ZATCA_API_PATHS[request.environment],
    status: response.status,
    ok: response.ok,
    requestId,
    globalTransactionId,
    correlationId: globalTransactionId || requestId || `compliance-csid-${requestStartedAt}`,
    durationMs,
    errorMessage: response.ok ? null : formatComplianceError(body, response.status),
    attempt: 0,
    warningCount: 0,
    errorCount: response.ok ? 0 : 1,
    responsePayload: sanitizeZatcaResponsePayload(body),
  })

  if (!response.ok) {
    throw new Error(formatComplianceError(body, response.status))
  }

  if (!body.binarySecurityToken || !body.secret) {
    throw new Error(body.dispositionMessage ?? 'ZATCA compliance response missing certificate or secret')
  }

  if (body.dispositionMessage && body.dispositionMessage !== 'ISSUED') {
    throw new Error(body.dispositionMessage)
  }

  return {
    requestId: body.requestID ?? '',
    dispositionMessage: body.dispositionMessage ?? 'ISSUED',
    binarySecurityToken: body.binarySecurityToken,
    secret: body.secret,
    certificatePem: wrapCertificatePem(body.binarySecurityToken),
  }
}
