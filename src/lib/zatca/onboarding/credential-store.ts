import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { ZatcaEnvironment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SaveCredentialInput, ZatcaOnboardingStatusView } from './types'

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

export async function getCredential(environment: ZatcaEnvironment) {
  return prisma.zatcaCredential.findUnique({ where: { environment } })
}

export async function saveCredential(input: SaveCredentialInput) {
  const updateData: Record<string, unknown> = {}

  if (input.csr !== undefined) updateData.csr = input.csr
  if (input.certificate !== undefined) updateData.certificate = input.certificate
  if (input.complianceCsid !== undefined) updateData.complianceCsid = input.complianceCsid
  if (input.productionCsid !== undefined) updateData.productionCsid = input.productionCsid
  if (input.productionCertificate !== undefined) updateData.productionCertificate = input.productionCertificate
  if (input.onboardingStatus !== undefined) updateData.onboardingStatus = input.onboardingStatus
  if (input.lastError !== undefined) updateData.lastError = input.lastError
  if (input.onboardedAt !== undefined) updateData.onboardedAt = input.onboardedAt
  if (input.privateKeyPem !== undefined) {
    updateData.privateKeyEnc = encryptSecret(input.privateKeyPem)
  }
  if (input.secret !== undefined) {
    updateData.secretEnc = encryptSecret(input.secret)
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

export async function getOnboardingStatus(
  environment: ZatcaEnvironment,
): Promise<ZatcaOnboardingStatusView> {
  const cred = await getCredential(environment)

  if (!cred) {
    return {
      environment,
      onboardingStatus: 'NOT_STARTED',
      hasCsr: false,
      hasCertificate: false,
      hasComplianceCsid: false,
      hasProductionCsid: false,
      onboardedAt: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }
  }

  return {
    environment: cred.environment,
    onboardingStatus: cred.onboardingStatus,
    hasCsr: Boolean(cred.csr),
    hasCertificate: Boolean(cred.certificate),
    hasComplianceCsid: Boolean(cred.complianceCsid),
    hasProductionCsid: Boolean(cred.productionCsid),
    onboardedAt: cred.onboardedAt?.toISOString() ?? null,
    lastError: cred.lastError,
    updatedAt: cred.updatedAt.toISOString(),
  }
}
