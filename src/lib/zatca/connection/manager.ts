import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { logZatcaAudit } from '../audit/logger'
import { getCertificateStatus } from '../onboarding/certificate-status'
import { getCredential, getOnboardingStatus } from '../onboarding/credential-store'
import { runComplianceChecks } from '../onboarding/compliance-checks'
import { requestAndStoreProductionCsid } from '../onboarding/service'
import { storeCredentials } from '../onboarding/credential-store'
import type { OnboardingAuditContext } from '../onboarding/types'

export type OnboardingResumeStage =
  | 'NOT_STARTED'
  | 'NEEDS_OTP'
  | 'NEEDS_COMPLIANCE_CHECKS'
  | 'NEEDS_PRODUCTION_CSID'
  | 'PRODUCTION_READY'
  | 'FAILED'

export function resolveResumeStage(input: {
  onboardingStatus: string
  hasProductionCsid: boolean
  hasComplianceCsid: boolean
}): OnboardingResumeStage {
  if (input.onboardingStatus === 'FAILED' && !input.hasComplianceCsid) return 'NEEDS_OTP'
  if (input.onboardingStatus === 'PRODUCTION_READY' || input.hasProductionCsid) return 'PRODUCTION_READY'
  if (input.onboardingStatus === 'COMPLIANCE_VALIDATED') return 'NEEDS_PRODUCTION_CSID'
  if (
    input.hasComplianceCsid
    && (
      input.onboardingStatus === 'COMPLIANCE_ISSUED'
      || input.onboardingStatus === 'FAILED'
    )
  ) {
    return 'NEEDS_COMPLIANCE_CHECKS'
  }
  if (input.onboardingStatus === 'CSR_GENERATED') return 'NEEDS_OTP'
  if (!input.hasComplianceCsid) return 'NOT_STARTED'
  return 'NEEDS_OTP'
}

async function getLatestConnectionTest(environment: ZatcaEnvironment) {
  const companyId = await resolveCompanyId()
  const { data, error } = await supabaseDb()
    .from('zatca_audit_logs')
    .select('created_at, result, message, metadata')
    .eq('company_id', companyId)
    .eq('action', 'CONNECTION_TEST')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  const row = (data ?? []).find((entry) => {
    const meta = entry.metadata as { environment?: string } | null
    return meta?.environment === environment
  })

  if (!row) return null

  return {
    at: row.created_at as string,
    ok: row.result === 'SUCCESS',
    message: (row.message as string | null) ?? '',
  }
}

export async function getEnvironmentConnectionView(environment: ZatcaEnvironment) {
  const [status, certificates, lastTest, credential] = await Promise.all([
    getOnboardingStatus(environment),
    getCertificateStatus(environment),
    getLatestConnectionTest(environment),
    getCredential(environment),
  ])

  const resumeStage = resolveResumeStage({
    onboardingStatus: status.onboardingStatus,
    hasProductionCsid: status.hasProductionCsid,
    hasComplianceCsid: status.hasComplianceCsid,
  })

  return {
    environment,
    status,
    certificates,
    lastConnectionTest: lastTest,
    resumeStage,
    complianceCsid: credential?.complianceCsid ?? null,
    productionCsid: credential?.productionCsid ?? null,
    connected: status.connectionStatus === 'CONNECTED',
  }
}

export async function getConnectionManagerSnapshot() {
  const settings = await getSettingsRepository().findFirst()
  const activeEnvironment = settings?.zatcaEnvironment ?? 'SANDBOX'

  const [simulation, production] = await Promise.all([
    getEnvironmentConnectionView('SANDBOX'),
    getEnvironmentConnectionView('PRODUCTION'),
  ])

  return {
    activeEnvironment,
    simulation,
    production,
    companyName: settings?.companyName ?? null,
  }
}

/**
 * Resumes onboarding after Compliance CSID without requiring a new OTP.
 */
export async function resumeZatcaOnboarding(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
) {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new Error('Company settings not found')

  const status = await getOnboardingStatus(environment)
  const stage = resolveResumeStage({
    onboardingStatus: status.onboardingStatus,
    hasProductionCsid: status.hasProductionCsid,
    hasComplianceCsid: status.hasComplianceCsid,
  })

  if (stage === 'PRODUCTION_READY') {
    return { stage, message: 'Production credentials are already in place.' }
  }

  if (stage === 'NOT_STARTED' || stage === 'NEEDS_OTP') {
    throw new Error('Onboarding cannot be resumed at this stage. Start onboarding with a new OTP from the Fatoora portal.')
  }

  await logZatcaAudit({
    action: 'ONBOARDING_RESUMED',
    result: 'SUCCESS',
    message: `Resuming onboarding from stage ${stage}`,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment, stage },
  })

  const warnings: string[] = []

  if (stage === 'NEEDS_COMPLIANCE_CHECKS' || stage === 'NEEDS_PRODUCTION_CSID') {
    if (stage === 'NEEDS_COMPLIANCE_CHECKS') {
      try {
        const complianceChecks = await runComplianceChecks(environment, auditContext)
        if (!complianceChecks.passed) {
          const failed = complianceChecks.results.filter((r) => !r.passed).map((r) => r.scenario).join(', ')
          throw new Error(`Compliance checks failed: ${failed}`)
        }
        await storeCredentials({ environment, onboardingStatus: 'COMPLIANCE_VALIDATED', lastError: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logZatcaAudit({
          action: 'ONBOARDING_FAILED',
          result: 'FAILED',
          message,
          userId: auditContext?.userId,
          userName: auditContext?.userName,
          companyName: settings.companyName,
          metadata: { environment, stage: 'compliance_checks' },
        })
        throw error
      }
    }

    try {
      const production = await requestAndStoreProductionCsid(environment, auditContext)
      await storeCredentials({ environment, onboardingStatus: 'PRODUCTION_READY', lastError: null })
      const connectionUpdates: Record<string, unknown> = { zatcaEnabled: true }
      if (settings.zatcaEnvironment === environment) {
        connectionUpdates.zatcaConnected = true
        connectionUpdates.zatcaConnectedAt = new Date()
      }
      await getSettingsRepository().update(settings.id, connectionUpdates)

      return {
        stage: 'PRODUCTION_READY',
        message: 'Production CSID issued successfully.',
        requestId: production.requestId,
        warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await storeCredentials({
        environment,
        onboardingStatus: 'COMPLIANCE_VALIDATED',
        lastError: message,
      })
      throw error
    }
  }

  throw new Error(`Unsupported resume stage: ${stage}`)
}
