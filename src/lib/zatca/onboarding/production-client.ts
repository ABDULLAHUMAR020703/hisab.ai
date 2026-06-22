import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import { buildBasicAuthHeader } from '../signature/certificate'
import { getApiBaseUrl, isMockMode } from './compliance-client'
import { getDecryptedCertificate, getDecryptedSecret, getCredential } from './credential-store'
import type { ProductionCsidResponse } from './types'

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
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

function mockProductionResponse(environment: ZatcaEnvironment): ProductionCsidResponse {
  const token = Buffer.from(`MOCK-PROD-CSID-${environment}-${Date.now()}`).toString('base64')
  return {
    requestId: `MOCK-PROD-${Date.now()}`,
    dispositionMessage: 'ISSUED',
    binarySecurityToken: token,
    secret: `mock-production-secret-${Date.now()}`,
    certificatePem: wrapCertificatePem(token),
  }
}

interface ZatcaProductionApiResponse {
  requestID?: string
  dispositionMessage?: string
  binarySecurityToken?: string
  secret?: string
  errors?: Array<{ message?: string; code?: string }> | null
}

/**
 * Requests Production CSID from ZATCA using compliance certificate credentials.
 */
export async function requestProductionCsid(
  environment: ZatcaEnvironment,
): Promise<ProductionCsidResponse> {
  const cred = await getCredential(environment)
  if (!cred?.complianceCsid) {
    throw new Error('Compliance CSID must be issued before requesting production CSID.')
  }

  const complianceCertificate = await getDecryptedCertificate(environment)
  if (!complianceCertificate) {
    throw new Error('Compliance certificate must be issued before requesting production CSID.')
  }

  if (isMockMode()) {
    return mockProductionResponse(environment)
  }

  const secret = await getDecryptedSecret(environment)
  if (!secret) {
    throw new Error('ZATCA secret not found in credential store.')
  }

  const csidToken = pemToBase64Der(complianceCertificate)
  const productionPath = environment === 'SANDBOX'
    ? '/e-invoicing/simulation/production/csids'
    : '/e-invoicing/core/production/csids'
  const url = `${getApiBaseUrl()}${productionPath}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      Authorization: buildBasicAuthHeader(csidToken, secret),
      'compliance-request-id': cred.complianceCsid,
    },
    body: JSON.stringify({
      compliance_request_id: cred.complianceCsid,
    }),
  })

  const body = (await response.json().catch(() => ({}))) as ZatcaProductionApiResponse

  if (!response.ok) {
    const message = body.errors?.[0]?.message
      ?? body.dispositionMessage
      ?? `Production CSID request failed (${response.status})`
    throw new Error(message)
  }

  if (!body.binarySecurityToken || !body.secret) {
    throw new Error(body.dispositionMessage ?? 'Production CSID response missing certificate or secret')
  }

  return {
    requestId: body.requestID ?? '',
    dispositionMessage: body.dispositionMessage ?? 'ISSUED',
    binarySecurityToken: body.binarySecurityToken,
    secret: body.secret,
    certificatePem: wrapCertificatePem(body.binarySecurityToken),
  }
}
