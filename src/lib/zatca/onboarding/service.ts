import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { logZatcaAudit } from '../audit/logger'
import { requestComplianceCsid } from './compliance-client'
import {
  getCredential,
  getDecryptedCsr,
  getOnboardingStatus,
  storeCredentials,
} from './credential-store'
import { generateEgsIdentity } from './egs-identity'
import { companySettingsToCsrInput, generateCSR } from './generate-csr-company'
import { csrPemToZatcaBase64 } from './generate-csr'
import { requestProductionCsid } from './production-client'
import { resolveOnboardingStatusAfterProductionFailure } from './onboarding-status'
import type { OnboardingAuditContext } from './types'

export type { OnboardingAuditContext }

async function getCompanySettingsOrThrow() {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) {
    throw new Error('Company settings not found')
  }
  return settings
}

/**
 * Generates and stores a ZATCA CSR for the given environment.
 */
export async function generateAndStoreCsr(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
) {
  const settings = await getCompanySettingsOrThrow()

  if (!settings.taxId?.trim()) {
    throw new Error('VAT registration number (taxId) is required before generating a CSR')
  }

  const egsIdentity = generateEgsIdentity(
    settings.legalName || settings.companyName,
    settings.taxId,
    environment,
    settings.zatcaBusinessCategory,
  )

  if (settings.zatcaEnvironment === environment) {
    await getSettingsRepository().update(settings.id, {
      zatcaEgsUnitId: egsIdentity.egsUnitId,
      zatcaDeviceIdentifier: egsIdentity.deviceIdentifier,
      zatcaEgsSerialNumber: egsIdentity.egsSerialNumber,
    })
  }

  const csrResult = await generateCSR(
    companySettingsToCsrInput({ ...settings, zatcaEnvironment: environment }, egsIdentity),
  )

  await storeCredentials({
    environment,
    companySettingsId: settings.id,
    egsUnitId: egsIdentity.egsUnitId,
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
export async function submitComplianceOnboarding(
  environment: ZatcaEnvironment,
  otp: string,
  auditContext?: OnboardingAuditContext,
) {
  const settings = await getCompanySettingsOrThrow()
  const csrPem = await getDecryptedCsr(environment)

  if (!csrPem) {
    throw new Error('CSR not found. Generate a CSR before requesting compliance CSID.')
  }

  try {
    await logZatcaAudit({
      action: 'COMPLIANCE_CSID_REQUESTED',
      result: 'SUCCESS',
      message: 'Submitting stored CSR to ZATCA compliance API',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment },
    })

    const response = await requestComplianceCsid({
      csrBase64: csrPemToZatcaBase64(csrPem),
      otp,
      environment,
    })

    const existingCred = await getCredential(environment)
    const egsUnitId = existingCred?.egsUnitId
      ?? generateEgsIdentity(
        settings.legalName || settings.companyName,
        settings.taxId,
        environment,
        settings.zatcaBusinessCategory,
      ).egsUnitId

    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      egsUnitId,
      certificate: response.certificatePem,
      binarySecurityToken: response.binarySecurityToken,
      secret: response.secret,
      complianceCsid: response.requestId || response.binarySecurityToken.slice(0, 64),
      requestId: response.requestId,
      onboardingStatus: 'COMPLIANCE_ISSUED',
      lastError: null,
      onboardedAt: new Date(),
    })

    if (settings.zatcaEnvironment === environment) {
      await getSettingsRepository().update(settings.id, { zatcaConnected: true })
    }

    await logZatcaAudit({
      action: 'CREDENTIALS_STORED',
      result: 'SUCCESS',
      message: 'Compliance CSID credentials encrypted and stored',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { requestId: response.requestId, environment },
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

    await logZatcaAudit({
      action: 'ONBOARDING_COMPLETED',
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
    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      onboardingStatus: 'FAILED',
      lastError: message,
    })
    await logZatcaAudit({
      action: 'ONBOARDING_FAILED',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment },
    })
    throw error
  }
}

/**
 * Requests Production CSID after compliance onboarding and stores credentials.
 */
export async function requestAndStoreProductionCsid(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
) {
  const settings = await getCompanySettingsOrThrow()

  try {
    const response = await requestProductionCsid(environment)

    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      productionCsid: response.requestId || response.binarySecurityToken.slice(0, 64),
      productionCertificate: response.certificatePem,
      productionBinarySecurityToken: response.binarySecurityToken,
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
      metadata: { requestId: response.requestId, globalTransactionId: response.globalTransactionId, environment },
    })

    return {
      environment,
      dispositionMessage: response.dispositionMessage,
      requestId: response.requestId,
      globalTransactionId: response.globalTransactionId,
      status: await getOnboardingStatus(environment),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const priorStatus = await getOnboardingStatus(environment)
    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      onboardingStatus: resolveOnboardingStatusAfterProductionFailure(
        priorStatus.onboardingStatus,
        priorStatus.hasComplianceCsid,
      ),
      lastError: message,
    })
    await logZatcaAudit({
      action: 'PRODUCTION_CSID_ISSUED',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment, preservedStatus: priorStatus.onboardingStatus },
    })
    throw error
  }
}

export { getOnboardingStatus }
