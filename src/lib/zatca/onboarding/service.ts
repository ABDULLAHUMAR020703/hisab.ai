import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logZatcaAudit } from '../audit/logger'
import { requestComplianceCsid } from './compliance-client'
import { requestProductionCsid } from './production-client'
import { getCredential, getOnboardingStatus, saveCredential } from './credential-store'
import { csrPemToBase64, generateZatcaCsr } from './generate-csr'

export interface OnboardingAuditContext {
  userId?: string
  userName?: string | null
}

async function getCompanySettingsOrThrow() {
  const settings = await prisma.companySettings.findFirst()
  if (!settings) {
    throw new Error('Company settings not found')
  }
  return settings
}

/**
 * Generates and stores a ZATCA CSR for the active company environment.
 */
export async function generateAndStoreCsr(auditContext?: OnboardingAuditContext) {
  const settings = await getCompanySettingsOrThrow()
  const environment: ZatcaEnvironment = settings.zatcaEnvironment

  if (!settings.taxId?.trim()) {
    throw new Error('VAT registration number (taxId) is required before generating a CSR')
  }

  const organizationName = (settings.legalName || settings.companyName).trim()
  const registeredAddress = [
    settings.buildingNumber,
    settings.streetAddress || settings.address,
    settings.district,
    settings.city,
    settings.postalCode,
  ].filter(Boolean).join(', ') || settings.city || 'Riyadh'

  const csrResult = generateZatcaCsr({
    environment,
    vatNumber: settings.taxId,
    organizationName,
    organizationUnit: settings.district || settings.city || 'Main Branch',
    registeredAddress,
    businessCategory: 'Telecommunications',
  })

  await saveCredential({
    environment,
    csr: csrResult.csrPem,
    privateKeyPem: csrResult.privateKeyPem,
    onboardingStatus: 'CSR_GENERATED',
    lastError: null,
  })

  await logZatcaAudit({
    action: 'CSR_GENERATED',
    result: 'SUCCESS',
    message: `CSR generated for ${csrResult.commonName}`,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment, commonName: csrResult.commonName },
  })

  return {
    environment,
    commonName: csrResult.commonName,
    csr: csrResult.csrPem,
    status: await getOnboardingStatus(environment),
  }
}

/**
 * Submits stored CSR to ZATCA compliance API with OTP and persists CSID credentials.
 */
export async function submitComplianceOnboarding(otp: string, auditContext?: OnboardingAuditContext) {
  const settings = await getCompanySettingsOrThrow()
  const environment: ZatcaEnvironment = settings.zatcaEnvironment
  const credential = await getCredential(environment)

  if (!credential?.csr) {
    throw new Error('CSR not found. Generate a CSR before requesting compliance CSID.')
  }

  try {
    const response = await requestComplianceCsid({
      csrBase64: csrPemToBase64(credential.csr),
      otp,
      environment,
    })

    await saveCredential({
      environment,
      certificate: response.certificatePem,
      secret: response.secret,
      complianceCsid: response.requestId || response.binarySecurityToken.slice(0, 64),
      onboardingStatus: 'COMPLIANCE_ISSUED',
      lastError: null,
      onboardedAt: new Date(),
    })

    await logZatcaAudit({
      action: 'COMPLIANCE_CSID_ISSUED',
      result: 'SUCCESS',
      message: response.dispositionMessage,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { requestId: response.requestId, environment },
    })

    return {
      environment,
      dispositionMessage: response.dispositionMessage,
      requestId: response.requestId,
      status: await getOnboardingStatus(environment),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await saveCredential({
      environment,
      onboardingStatus: 'FAILED',
      lastError: message,
    })
    await logZatcaAudit({
      action: 'COMPLIANCE_CSID_ISSUED',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
    })
    throw error
  }
}

/**
 * Requests Production CSID after compliance onboarding and stores credentials.
 */
export async function requestAndStoreProductionCsid(auditContext?: OnboardingAuditContext) {
  const settings = await getCompanySettingsOrThrow()
  const environment: ZatcaEnvironment = settings.zatcaEnvironment

  try {
    const response = await requestProductionCsid(environment)

    await saveCredential({
      environment,
      productionCsid: response.requestId || response.binarySecurityToken.slice(0, 64),
      productionCertificate: response.certificatePem,
      secret: response.secret,
      onboardingStatus: 'PRODUCTION_ISSUED',
      lastError: null,
    })

    await logZatcaAudit({
      action: 'PRODUCTION_CSID_ISSUED',
      result: 'SUCCESS',
      message: response.dispositionMessage,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { requestId: response.requestId, environment },
    })

    return {
      environment,
      dispositionMessage: response.dispositionMessage,
      requestId: response.requestId,
      status: await getOnboardingStatus(environment),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await saveCredential({
      environment,
      onboardingStatus: 'FAILED',
      lastError: message,
    })
    await logZatcaAudit({
      action: 'PRODUCTION_CSID_ISSUED',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
    })
    throw error
  }
}

export { getOnboardingStatus }
