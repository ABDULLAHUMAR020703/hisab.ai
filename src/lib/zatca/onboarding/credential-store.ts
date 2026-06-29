import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, X509Certificate } from 'crypto'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import {
  getCredential as getSupabaseCredential,
  upsertCredential as upsertSupabaseCredential,
} from '@/lib/db/zatca.repository'
import type { SaveCredentialInput as DbSaveCredentialInput } from '@/lib/db/types'
import { prisma } from '@/lib/prisma'
import { isSupabaseEnabled } from '@/lib/supabase/env'
import type { SaveCredentialInput, ZatcaOnboardingStatusView } from './types'
import { resolveConnectionLabel } from './validate-onboarding'

const ENCRYPTION_SALT = 'hisab-zatca-v1'

function getEncryptionKey(): Buffer {
  const secret = process.env.ZATCA_CREDENTIAL_ENCRYPTION_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ZATCA_CREDENTIAL_ENCRYPTION_KEY must be set in production')
    }
    return scryptSync('dev-only-zatca-key-change-me', ENCRYPTION_SALT, 32)
  }
  return scryptSync(secret, ENCRYPTION_SALT, 32)
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey()
  const data = Buffer.from(ciphertext, 'base64')
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const encrypted = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function decryptField(enc: string | null | undefined, plain: string | null | undefined): string | null {
  if (enc) return decryptSecret(enc)
  return plain ?? null
}

export function extractCertificateDates(certificatePem: string): {
  issuedAt: Date
  validFrom: Date
  validTo: Date
} | null {
  try {
    const cert = new X509Certificate(certificatePem)
    const validFrom = new Date(cert.validFrom)
    return {
      issuedAt: validFrom,
      validFrom,
      validTo: new Date(cert.validTo),
    }
  } catch {
    return null
  }
}

export async function getCredential(environment: ZatcaEnvironment) {
  if (isSupabaseEnabled()) {
    return getSupabaseCredential(environment)
  }

  return prisma.zatcaCredential.findUnique({ where: { environment } })
}

/** Persists ZATCA credentials with AES-256-GCM encryption for sensitive fields. */
export async function storeCredentials(input: SaveCredentialInput) {
  return saveCredential(input)
}

export async function saveCredential(input: SaveCredentialInput) {
  const updateData: Record<string, unknown> = {}
  const supabaseInput: DbSaveCredentialInput = {
    environment: input.environment,
    companySettingsId: input.companySettingsId,
  }

  if (input.companySettingsId !== undefined) updateData.companySettingsId = input.companySettingsId
  if (input.egsUnitId !== undefined) {
    updateData.egsUnitId = input.egsUnitId
    supabaseInput.egsUnitId = input.egsUnitId
  }
  if (input.requestId !== undefined) {
    updateData.requestId = input.requestId
    supabaseInput.requestId = input.requestId
  }
  if (input.complianceCsid !== undefined) {
    updateData.complianceCsid = input.complianceCsid
    supabaseInput.complianceCsid = input.complianceCsid
  }
  if (input.productionCsid !== undefined) {
    updateData.productionCsid = input.productionCsid
    supabaseInput.productionCsid = input.productionCsid
  }
  if (input.onboardingStatus !== undefined) {
    updateData.onboardingStatus = input.onboardingStatus
    supabaseInput.onboardingStatus = input.onboardingStatus
  }
  if (input.lastError !== undefined) {
    updateData.lastError = input.lastError
    supabaseInput.lastError = input.lastError
  }
  if (input.onboardedAt !== undefined) {
    updateData.onboardedAt = input.onboardedAt
    supabaseInput.onboardedAt = input.onboardedAt
  }

  if (input.csr !== undefined) {
    const csrEnc = encryptSecret(input.csr)
    updateData.csrEnc = csrEnc
    updateData.csr = null
    supabaseInput.csrEnc = csrEnc
  }
  if (input.certificate !== undefined) {
    const certificateEnc = encryptSecret(input.certificate)
    const dates = extractCertificateDates(input.certificate)
    updateData.certificateEnc = certificateEnc
    updateData.certificate = null
    supabaseInput.certificateEnc = certificateEnc
    if (dates) {
      updateData.complianceCertIssuedAt = dates.issuedAt
      updateData.complianceCertValidFrom = dates.validFrom
      updateData.complianceCertValidTo = dates.validTo
      supabaseInput.complianceCertIssuedAt = dates.issuedAt
      supabaseInput.complianceCertValidFrom = dates.validFrom
      supabaseInput.complianceCertValidTo = dates.validTo
    }
  }
  if (input.productionCertificate !== undefined) {
    const productionCertificateEnc = encryptSecret(input.productionCertificate)
    const dates = extractCertificateDates(input.productionCertificate)
    updateData.productionCertificateEnc = productionCertificateEnc
    updateData.productionCertificate = null
    supabaseInput.productionCertificateEnc = productionCertificateEnc
    if (dates) {
      updateData.productionCertIssuedAt = dates.issuedAt
      updateData.productionCertValidFrom = dates.validFrom
      updateData.productionCertValidTo = dates.validTo
      supabaseInput.productionCertIssuedAt = dates.issuedAt
      supabaseInput.productionCertValidFrom = dates.validFrom
      supabaseInput.productionCertValidTo = dates.validTo
    }
  }
  if (input.privateKeyPem !== undefined) {
    const privateKeyEnc = encryptSecret(input.privateKeyPem)
    updateData.privateKeyEnc = privateKeyEnc
    supabaseInput.privateKeyEnc = privateKeyEnc
  }
  if (input.secret !== undefined) {
    const secretEnc = encryptSecret(input.secret)
    updateData.secretEnc = secretEnc
    supabaseInput.secretEnc = secretEnc
  }
  if (input.binarySecurityToken !== undefined) {
    const binarySecurityTokenEnc = encryptSecret(input.binarySecurityToken)
    updateData.binarySecurityTokenEnc = binarySecurityTokenEnc
    supabaseInput.binarySecurityTokenEnc = binarySecurityTokenEnc
  }
  if (input.productionBinarySecurityToken !== undefined) {
    const productionBinarySecurityTokenEnc = encryptSecret(input.productionBinarySecurityToken)
    updateData.productionBinarySecurityTokenEnc = productionBinarySecurityTokenEnc
    supabaseInput.productionBinarySecurityTokenEnc = productionBinarySecurityTokenEnc
  }

  if (isSupabaseEnabled()) {
    return upsertSupabaseCredential(supabaseInput)
  }

  return prisma.zatcaCredential.upsert({
    where: { environment: input.environment },
    create: {
      environment: input.environment,
      onboardingStatus: input.onboardingStatus ?? 'NOT_STARTED',
      ...updateData,
    },
    update: updateData,
  })
}

export async function backfillCertificateValidity(environment: ZatcaEnvironment) {
  const cred = await getCredential(environment)
  if (!cred) return null

  const supabaseInput: DbSaveCredentialInput = {
    environment,
    companyId: cred.companyId,
  }
  const prismaData: Record<string, Date> = {}

  const complianceCertificate = decryptField(cred.certificateEnc, cred.certificate)
  if (
    complianceCertificate
    && (!cred.complianceCertIssuedAt || !cred.complianceCertValidFrom || !cred.complianceCertValidTo)
  ) {
    const dates = extractCertificateDates(complianceCertificate)
    if (dates) {
      supabaseInput.complianceCertIssuedAt = dates.issuedAt
      supabaseInput.complianceCertValidFrom = dates.validFrom
      supabaseInput.complianceCertValidTo = dates.validTo
      prismaData.complianceCertIssuedAt = dates.issuedAt
      prismaData.complianceCertValidFrom = dates.validFrom
      prismaData.complianceCertValidTo = dates.validTo
    }
  }

  const productionCertificate = decryptField(cred.productionCertificateEnc, cred.productionCertificate)
  if (
    productionCertificate
    && (!cred.productionCertIssuedAt || !cred.productionCertValidFrom || !cred.productionCertValidTo)
  ) {
    const dates = extractCertificateDates(productionCertificate)
    if (dates) {
      supabaseInput.productionCertIssuedAt = dates.issuedAt
      supabaseInput.productionCertValidFrom = dates.validFrom
      supabaseInput.productionCertValidTo = dates.validTo
      prismaData.productionCertIssuedAt = dates.issuedAt
      prismaData.productionCertValidFrom = dates.validFrom
      prismaData.productionCertValidTo = dates.validTo
    }
  }

  if (Object.keys(prismaData).length === 0) return cred

  if (isSupabaseEnabled()) {
    return upsertSupabaseCredential(supabaseInput)
  }

  await prisma.zatcaCredential.update({
    where: { environment },
    data: prismaData,
  })
  return getCredential(environment)
}

export async function getDecryptedPrivateKey(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred?.privateKeyEnc) return null
  return decryptSecret(cred.privateKeyEnc)
}

export async function getDecryptedSecret(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred?.secretEnc) return null
  return decryptSecret(cred.secretEnc)
}

export async function getDecryptedBinarySecurityToken(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred?.binarySecurityTokenEnc) return null
  return decryptSecret(cred.binarySecurityTokenEnc)
}

export async function getDecryptedProductionBinarySecurityToken(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred?.productionBinarySecurityTokenEnc) return null
  return decryptSecret(cred.productionBinarySecurityTokenEnc)
}

export async function getDecryptedCsr(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred) return null
  return decryptField(cred.csrEnc, cred.csr)
}

export async function getDecryptedCertificate(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred) return null
  return decryptField(cred.certificateEnc, cred.certificate)
}

export async function getDecryptedProductionCertificate(environment: ZatcaEnvironment): Promise<string | null> {
  const cred = await getCredential(environment)
  if (!cred) return null
  return decryptField(cred.productionCertificateEnc, cred.productionCertificate)
}

export async function getOnboardingStatus(
  environment: ZatcaEnvironment,
): Promise<ZatcaOnboardingStatusView> {
  const [cred, settings] = await Promise.all([
    getCredential(environment),
    getSettingsRepository().findFirst(),
  ])

  if (!cred) {
    return {
      environment,
      onboardingStatus: 'NOT_STARTED',
      connectionStatus: 'NOT_CONNECTED',
      zatcaConnected: settings?.zatcaConnected ?? false,
      egsUnitId: settings?.zatcaEgsUnitId ?? null,
      hasCsr: false,
      hasCertificate: false,
      hasComplianceCsid: false,
      hasProductionCsid: false,
      onboardedAt: null,
      lastError: null,
      requestId: null,
      updatedAt: new Date().toISOString(),
    }
  }

  const hasCsr = Boolean(cred.csrEnc || cred.csr)
  const hasCertificate = Boolean(cred.certificateEnc || cred.certificate)

  return {
    environment: cred.environment,
    onboardingStatus: cred.onboardingStatus,
    connectionStatus: resolveConnectionLabel(
      settings?.zatcaConnected ?? false,
      cred.onboardingStatus,
    ),
    zatcaConnected: settings?.zatcaConnected ?? false,
    egsUnitId: cred.egsUnitId ?? settings?.zatcaEgsUnitId ?? null,
    hasCsr,
    hasCertificate,
    hasComplianceCsid: Boolean(cred.complianceCsid || cred.binarySecurityTokenEnc),
    hasProductionCsid: Boolean(cred.productionCsid),
    onboardedAt: cred.onboardedAt?.toISOString() ?? null,
    lastError: cred.lastError,
    requestId: cred.requestId,
    updatedAt: cred.updatedAt.toISOString(),
  }
}

export async function testStoredConnection(environment: ZatcaEnvironment): Promise<{
  ok: boolean
  message: string
  hasPrivateKey: boolean
  hasCertificate: boolean
  hasSecret: boolean
  failures?: string[]
}> {
  if (environment === 'PRODUCTION') {
    return testProductionStoredConnection(environment)
  }
  return testSimulationStoredConnection(environment)
}

async function testSimulationStoredConnection(environment: ZatcaEnvironment) {
  const failures: string[] = []
  const cred = await getCredential(environment)

  const privateKey = await getDecryptedPrivateKey(environment)
  if (!privateKey) failures.push('Private key missing')

  const certificate = await getDecryptedCertificate(environment)
  if (!certificate) {
    failures.push('Compliance certificate missing')
  } else {
    const dates = extractCertificateDates(certificate)
    if (dates && dates.validTo.getTime() <= Date.now()) {
      failures.push('Compliance certificate expired')
    }
  }

  const secret = await getDecryptedSecret(environment)
  if (!secret) failures.push('Compliance secret missing')

  if (!cred?.complianceCsid && !cred?.binarySecurityTokenEnc) {
    failures.push('Compliance CSID missing')
  }

  const ok = failures.length === 0

  return {
    ok,
    hasPrivateKey: Boolean(privateKey),
    hasCertificate: Boolean(certificate),
    hasSecret: Boolean(secret),
    failures,
    message: ok
      ? 'Simulation credentials are present and decryptable.'
      : failures.join('; '),
  }
}

async function testProductionStoredConnection(environment: ZatcaEnvironment) {
  const failures: string[] = []
  const cred = await getCredential(environment)

  if (!cred?.productionCsid) {
    failures.push('Production CSID missing')
  }

  const privateKey = await getDecryptedPrivateKey(environment)
  if (!privateKey) failures.push('Private key missing')

  const productionToken = await getDecryptedProductionBinarySecurityToken(environment)
  if (!productionToken) failures.push('Production BinarySecurityToken missing')

  const productionCertificate = await getDecryptedProductionCertificate(environment)
  if (!productionCertificate) {
    failures.push('Production certificate missing')
  } else {
    const dates = extractCertificateDates(productionCertificate)
    if (dates && dates.validTo.getTime() <= Date.now()) {
      failures.push('Production certificate expired')
    }
  }

  const secret = await getDecryptedSecret(environment)
  if (!secret) failures.push('Production secret missing')

  const ok = failures.length === 0

  return {
    ok,
    hasPrivateKey: Boolean(privateKey),
    hasCertificate: Boolean(productionCertificate),
    hasSecret: Boolean(secret),
    failures,
    message: ok
      ? 'Production credentials are present, decryptable, and the certificate is valid.'
      : failures.join('; '),
  }
}
