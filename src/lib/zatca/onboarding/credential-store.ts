import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
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
    updateData.certificateEnc = certificateEnc
    updateData.certificate = null
    supabaseInput.certificateEnc = certificateEnc
  }
  if (input.productionCertificate !== undefined) {
    const productionCertificateEnc = encryptSecret(input.productionCertificate)
    updateData.productionCertificateEnc = productionCertificateEnc
    updateData.productionCertificate = null
    supabaseInput.productionCertificateEnc = productionCertificateEnc
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
}> {
  const [privateKey, certificate, secret] = await Promise.all([
    getDecryptedPrivateKey(environment),
    getDecryptedCertificate(environment),
    getDecryptedSecret(environment),
  ])

  const hasPrivateKey = Boolean(privateKey)
  const hasCertificate = Boolean(certificate)
  const hasSecret = Boolean(secret)
  const ok = hasPrivateKey && hasCertificate && hasSecret

  return {
    ok,
    hasPrivateKey,
    hasCertificate,
    hasSecret,
    message: ok
      ? 'ZATCA credentials are present and decryptable for this environment.'
      : 'Missing or incomplete ZATCA credentials. Complete onboarding or regenerate CSR.',
  }
}
