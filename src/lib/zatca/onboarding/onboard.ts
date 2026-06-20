import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logZatcaAudit } from '../audit/logger'
import { requestComplianceCsid } from './compliance-client'
import { runComplianceChecks } from './compliance-checks'
import {
  getCredential,
  getDecryptedCsr,
  getOnboardingStatus,
  storeCredentials,
  testStoredConnection,
} from './credential-store'
import { generateEgsIdentity } from './egs-identity'
import { companySettingsToCsrInput, generateCSR } from './generate-csr-company'
import { csrPemToZatcaBase64 } from './generate-csr'
import { mapOnboardingError } from './onboarding-errors'
import { verifyZatcaCsr } from './verify-csr'
import { requestAndStoreProductionCsid } from './service'
import {
  isAlreadyConnected,
  resolveActiveEnvironment,
  validateCompanyProfileForZatca,
} from './validate-onboarding'
import type { OnboardingAuditContext } from './types'

export interface RunZatcaOnboardingInput {
  otp: string
  environment?: ZatcaEnvironment
}

async function getCompanySettingsOrThrow() {
  const settings = await prisma.companySettings.findFirst()
  if (!settings) {
    throw new Error('Company settings not found')
  }
  return settings
}

async function persistEgsIdentity(
  settingsId: string,
  identity: ReturnType<typeof generateEgsIdentity>,
) {
  await prisma.companySettings.update({
    where: { id: settingsId },
    data: {
      zatcaEgsUnitId: identity.egsUnitId,
      zatcaDeviceIdentifier: identity.deviceIdentifier,
      zatcaEgsSerialNumber: identity.egsSerialNumber,
      zatcaBusinessCategory: identity.businessCategory,
    },
  })
  return identity
}

/**
 * Fully automated ZATCA onboarding — taxpayer supplies OTP only.
 * Generates EGS identity, keys, CSR, compliance CSID, compliance checks, and production CSID.
 */
export async function runZatcaOnboarding(
  input: RunZatcaOnboardingInput,
  auditContext?: OnboardingAuditContext,
) {
  const settings = await getCompanySettingsOrThrow()
  const environment = resolveActiveEnvironment(settings.zatcaEnvironment, input.environment)

  const validation = validateCompanyProfileForZatca(settings, { requireOtp: true, otp: input.otp })
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '))
  }

  const existing = await getCredential(environment)
  if (isAlreadyConnected(existing)) {
    throw new Error('This environment is already connected to ZATCA.')
  }

  // Clear a previous failed attempt so CSR + keys are regenerated fresh
  if (existing?.onboardingStatus === 'FAILED') {
    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      onboardingStatus: 'NOT_STARTED',
      lastError: null,
    })
  }

  const egsIdentity = generateEgsIdentity(
    settings.legalName || settings.companyName,
    settings.taxId,
    environment,
  )

  const onboardingRequest = await prisma.zatcaOnboardingRequest.create({
    data: {
      companySettingsId: settings.id,
      environment,
      egsUnitId: egsIdentity.egsUnitId,
      status: 'PENDING',
    },
  })

  await logZatcaAudit({
    action: 'ONBOARDING_STARTED',
    result: 'SUCCESS',
    message: `Automated ZATCA onboarding started for ${environment}`,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment, egsUnitId: egsIdentity.egsUnitId },
  })

  try {
    await persistEgsIdentity(settings.id, egsIdentity)

    const csrInput = companySettingsToCsrInput(
      { ...settings, zatcaEnvironment: environment },
      egsIdentity,
    )
    const csrResult = await generateCSR(csrInput)

    // Preflight: prove the generated CSR contains every ZATCA-required field in
    // the exact encoding the gateway expects, before spending the single-use OTP.
    const csrCheck = verifyZatcaCsr(csrResult.csrPem, {
      environment,
      vat: (settings.taxId ?? '').replace(/\D/g, ''),
      commonName: csrResult.commonName,
    })
    console.log('========== [ZATCA] CSR PREFLIGHT (self-check) ==========')
    console.log(`Environment: ${environment}`)
    console.log(csrCheck.summary)
    console.log(
      csrCheck.ok
        ? 'Result: ALL REQUIRED ZATCA FIELDS PRESENT AND CORRECTLY ENCODED'
        : `Result: MISSING REQUIRED FIELDS -> ${csrCheck.missingCritical.join(', ')}`,
    )
    console.log('=======================================================')
    if (!csrCheck.ok) {
      throw new Error(
        `CSR self-check failed before submission (internal): missing ${csrCheck.missingCritical.join(', ')}`,
      )
    }

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
      message: 'CSR and cryptographic keys generated automatically',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment, egsUnitId: egsIdentity.egsUnitId },
    })

    await logZatcaAudit({
      action: 'COMPLIANCE_CSID_REQUESTED',
      result: 'SUCCESS',
      message: 'Requesting compliance CSID from ZATCA',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment },
    })

    const response = await requestComplianceCsid({
      csrBase64: csrResult.csrBase64,
      otp: input.otp,
      environment,
    })

    const connectedAt = new Date()

    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      egsUnitId: egsIdentity.egsUnitId,
      certificate: response.certificatePem,
      binarySecurityToken: response.binarySecurityToken,
      secret: response.secret,
      complianceCsid: response.requestId || response.binarySecurityToken.slice(0, 64),
      requestId: response.requestId,
      onboardingStatus: 'COMPLIANCE_ISSUED',
      lastError: null,
      onboardedAt: connectedAt,
    })

    await prisma.companySettings.update({
      where: { id: settings.id },
      data: {
        zatcaEnabled: true,
        zatcaConnected: true,
        zatcaConnectedAt: connectedAt,
        zatcaEnvironment: environment,
      },
    })

    await logZatcaAudit({
      action: 'CREDENTIALS_STORED',
      result: 'SUCCESS',
      message: 'Compliance CSID credentials encrypted and stored',
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment, requestId: response.requestId },
    })

    // ---------------------------------------------------------------------
    // CONNECTION IS NOW ESTABLISHED: the Compliance CSID has been issued and
    // stored, and the (single-use) OTP has been consumed. Everything below is
    // best-effort enhancement (compliance invoice suite, then production CSID).
    // A failure here must NOT roll back the connection or ask the taxpayer to
    // regenerate the CSR / request a new OTP — that would waste a fresh OTP and
    // discard a valid CSID. We keep COMPLIANCE_ISSUED and surface warnings.
    // ---------------------------------------------------------------------
    const warnings: string[] = []
    let complianceChecks: Awaited<ReturnType<typeof runComplianceChecks>> | null = null
    let productionRequestId: string | undefined

    try {
      complianceChecks = await runComplianceChecks(environment, auditContext)

      if (complianceChecks.passed) {
        await storeCredentials({ environment, onboardingStatus: 'COMPLIANCE_VALIDATED', lastError: null })
        await logZatcaAudit({
          action: 'ONBOARDING_COMPLETED',
          result: 'SUCCESS',
          message: 'Compliance CSID issued and compliance invoice checks passed',
          userId: auditContext?.userId,
          userName: auditContext?.userName,
          companyName: settings.companyName,
          metadata: { requestId: response.requestId, environment },
        })

        try {
          const production = await requestAndStoreProductionCsid(auditContext)
          productionRequestId = production.requestId
          await storeCredentials({ environment, onboardingStatus: 'PRODUCTION_READY', lastError: null })
          await logZatcaAudit({
            action: 'PRODUCTION_CSID_ISSUED',
            result: 'SUCCESS',
            message: 'Production CSID issued — onboarding complete',
            userId: auditContext?.userId,
            userName: auditContext?.userName,
            companyName: settings.companyName,
            metadata: { environment, requestId: production.requestId },
          })
        } catch (prodError) {
          const msg = prodError instanceof Error ? prodError.message : String(prodError)
          console.error('[ZATCA] Production CSID step failed (connection kept):', msg)
          warnings.push(`Production certificate step deferred: ${msg}`)
          // requestAndStoreProductionCsid marks FAILED internally — restore the
          // real, connected state so we don't lose the issued Compliance CSID.
          await storeCredentials({
            environment,
            onboardingStatus: 'COMPLIANCE_VALIDATED',
            lastError: null,
          }).catch(() => null)
        }
      } else {
        const failed = complianceChecks.results
          .filter((r) => !r.passed)
          .map((r) => `${r.scenario}${r.error ? ` (${r.error})` : ''}`)
          .join('; ')
        console.error('[ZATCA] Compliance invoice checks did not pass (connection kept):', failed)
        warnings.push(`Compliance invoice checks need attention: ${failed}`)
      }
    } catch (postError) {
      const msg = postError instanceof Error ? postError.message : String(postError)
      console.error('[ZATCA] Post-onboarding step failed (connection kept):', msg)
      warnings.push(`Post-onboarding validation deferred: ${msg}`)
      // Ensure the connection state is intact regardless of where it threw.
      await storeCredentials({
        environment,
        onboardingStatus: 'COMPLIANCE_ISSUED',
        lastError: null,
      }).catch(() => null)
    }

    await prisma.zatcaOnboardingRequest.update({
      where: { id: onboardingRequest.id },
      data: {
        status: 'SUCCESS',
        requestId: productionRequestId || response.requestId,
        errorMessage: warnings.length ? warnings.join(' | ') : null,
      },
    }).catch(() => null)

    return {
      environment,
      egsUnitId: egsIdentity.egsUnitId,
      dispositionMessage: response.dispositionMessage,
      requestId: response.requestId,
      zatcaConnected: true,
      connectedAt: connectedAt.toISOString(),
      complianceChecks,
      productionRequestId,
      warnings,
      status: await getOnboardingStatus(environment),
    }
  } catch (error) {
    const mapped = mapOnboardingError(error, { environment })
    const message = mapped.message

    await storeCredentials({
      environment,
      companySettingsId: settings.id,
      onboardingStatus: 'FAILED',
      lastError: message,
    }).catch(() => null)

    await prisma.zatcaOnboardingRequest.update({
      where: { id: onboardingRequest.id },
      data: { status: 'FAILED', errorMessage: message },
    }).catch(() => null)

    await logZatcaAudit({
      action: 'ONBOARDING_FAILED',
      result: 'FAILED',
      message,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { environment, code: mapped.code },
    })

    const err = new Error(message)
    ;(err as Error & { code?: string; httpStatus?: number }).code = mapped.code
    ;(err as Error & { code?: string; httpStatus?: number }).httpStatus = mapped.httpStatus
    throw err
  }
}

export async function testZatcaConnection(environment?: ZatcaEnvironment) {
  const settings = await getCompanySettingsOrThrow()
  const env = environment ?? settings.zatcaEnvironment
  return testStoredConnection(env)
}

export { validateCompanyProfileForZatca as validateOnboardingState, mapOnboardingError }

export async function getStoredCsrBase64(environment: ZatcaEnvironment): Promise<string> {
  const csr = await getDecryptedCsr(environment)
  if (!csr) {
    throw new Error('CSR not found.')
  }
  return csrPemToZatcaBase64(csr)
}
