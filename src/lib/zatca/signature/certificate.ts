import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import {
  getCredential,
  getDecryptedPrivateKey,
  getDecryptedSecret,
  getDecryptedCertificate,
  getDecryptedBinarySecurityToken,
  getDecryptedProductionCertificate,
  getDecryptedProductionBinarySecurityToken,
} from '../onboarding/credential-store'

export interface SigningCredentials {
  certificatePem: string
  privateKeyPem: string
  secret: string
  csidToken: string
  environment: ZatcaEnvironment
  useProduction: boolean
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

  const csidToken = await getDecryptedBinarySecurityToken(environment)
  if (!csidToken) {
    throw new Error('Compliance binary security token missing from credential store.')
  }

  return {
    certificatePem,
    privateKeyPem,
    secret,
    csidToken,
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

  const hasProductionCertificate = Boolean(cred.productionCertificateEnc || cred.productionCertificate)
  if (!cred.productionCsid || !hasProductionCertificate || !cred.productionBinarySecurityTokenEnc) {
    throw new Error('Production CSID credentials required for reporting/clearance submission. Request Production CSID after compliance validation.')
  }

  const certificatePem = await getDecryptedProductionCertificate(environment)

  if (!certificatePem) {
    throw new Error('ZATCA certificate not found. Complete compliance onboarding first.')
  }

  const privateKeyPem = await getDecryptedPrivateKey(environment)
  const secret = await getDecryptedSecret(environment)

  if (!privateKeyPem || !secret) {
    throw new Error('ZATCA private key or secret missing from credential store.')
  }

  const csidToken = await getDecryptedProductionBinarySecurityToken(environment)
  if (!csidToken) {
    throw new Error('Production binary security token missing from credential store.')
  }

  return {
    certificatePem,
    privateKeyPem,
    secret,
    csidToken,
    environment,
    useProduction: true,
  }
}

export function buildBasicAuthHeader(csidToken: string, secret: string): string {
  return `Basic ${Buffer.from(`${csidToken}:${secret}`).toString('base64')}`
}
