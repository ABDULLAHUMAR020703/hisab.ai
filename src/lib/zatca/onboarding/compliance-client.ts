import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import type { ComplianceCsidRequest, ComplianceCsidResponse } from './types'

const ZATCA_API_PATHS: Record<ZatcaEnvironment, string> = {
  SANDBOX: '/e-invoicing/simulation/compliance',
  PRODUCTION: '/e-invoicing/core/compliance',
}

export function getApiBaseUrl(): string {
  return process.env.ZATCA_API_BASE_URL ?? 'https://gw-fatoora.zatca.gov.sa'
}

function wrapCertificatePem(binarySecurityToken: string): string {
  const lines = binarySecurityToken.match(/.{1,64}/g) ?? [binarySecurityToken]
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`
}

export function isMockMode(): boolean {
  return process.env.ZATCA_MOCK_ONBOARDING === 'true'
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
  errors?: Array<{ message?: string; code?: string }> | null
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      OTP: request.otp.trim(),
    },
    body: JSON.stringify({ csr: request.csrBase64 }),
  })

  const body = (await response.json().catch(() => ({}))) as ZatcaComplianceApiResponse

  if (!response.ok) {
    const message = body.errors?.[0]?.message
      ?? body.dispositionMessage
      ?? `ZATCA compliance request failed (${response.status})`
    throw new Error(message)
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
