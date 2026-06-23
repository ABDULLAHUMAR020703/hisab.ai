import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import {
  getCredential,
  getDecryptedPrivateKey,
  getDecryptedSecret,
  getDecryptedCertificate,
  getDecryptedProductionCertificate,
} from '../onboarding/credential-store'

export interface SigningCredentials {
  certificatePem: string
  privateKeyPem: string
  secret: string
  csidToken: string
  environment: ZatcaEnvironment
  useProduction: boolean
}

function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

/**
 * Loads signing credentials for invoice submission.
 * Prefers production CSID/certificate when available.
 */
/** Loads compliance CSID credentials (used for /compliance/invoices checks). */
export async function loadComplianceSigningCredentials(
  environment: ZatcaEnvironment,
): Promise<SigningCredentials> {
  const certificatePem = await getDecryptedCertificate(environment)
  if (!certificatePem) {
    throw new Error('Compliance certificate not found. Complete compliance onboarding first.')
  }

  const privateKeyPem = await getDecryptedPrivateKey(environment)
  const secret = await getDecryptedSecret(environment)

  if (!privateKeyPem || !secret) {
    throw new Error('ZATCA private key or secret missing from credential store.')
  }

  return {
    certificatePem,
    privateKeyPem,
    secret,
    csidToken: pemToBase64Der(certificatePem),
    environment,
    useProduction: false,
  }
}

export async function loadSigningCredentials(
  environment: ZatcaEnvironment,
): Promise<SigningCredentials> {
  const cred = await getCredential(environment)
  if (!cred) {
    throw new Error('ZATCA credentials not found. Complete onboarding first.')
  }

  const useProduction = Boolean(cred.productionCsid && (cred.productionCertificateEnc || cred.productionCertificate))
  const certificatePem = useProduction
    ? await getDecryptedProductionCertificate(environment)
    : await getDecryptedCertificate(environment)

  if (!certificatePem) {
    throw new Error('ZATCA certificate not found. Complete compliance onboarding first.')
  }

  const privateKeyPem = await getDecryptedPrivateKey(environment)
  const secret = await getDecryptedSecret(environment)

  if (!privateKeyPem || !secret) {
    throw new Error('ZATCA private key or secret missing from credential store.')
  }

  const csidToken = pemToBase64Der(certificatePem)

  return {
    certificatePem,
    privateKeyPem,
    secret,
    csidToken,
    environment,
    useProduction,
  }
}

export function buildBasicAuthHeader(csidToken: string, secret: string): string {
  return `Basic ${Buffer.from(`${csidToken}:${secret}`).toString('base64')}`
}
