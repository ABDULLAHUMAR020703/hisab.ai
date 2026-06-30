import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { deleteCredential as deleteSupabaseCredential } from '@/lib/db/zatca.repository'
import { logZatcaAudit } from '../audit/logger'
import { getCredential, getOnboardingStatus } from '../onboarding/credential-store'
import type { OnboardingAuditContext } from '../onboarding/types'

export async function deleteLocalCredentials(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
): Promise<void> {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new Error('Company settings not found')

  await deleteSupabaseCredential(environment)

  const updates: Record<string, unknown> = {}
  if (settings.zatcaEnvironment === environment) {
    updates.zatcaConnected = false
    updates.zatcaConnectedAt = null
  }

  if (Object.keys(updates).length > 0) {
    await getSettingsRepository().update(settings.id, updates)
  }

  await logZatcaAudit({
    action: 'CREDENTIALS_DELETED',
    result: 'SUCCESS',
    message: `Local ZATCA credentials deleted for ${environment}`,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment },
  })
}

export async function setActiveZatcaEnvironment(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
): Promise<void> {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new Error('Company settings not found')

  const previous = settings.zatcaEnvironment
  if (previous === environment) return

  const status = await getOnboardingStatus(environment)
  const credential = await getCredential(environment)

  const updates: Record<string, unknown> = {
    zatcaEnvironment: environment,
    zatcaConnected: status.connectionStatus === 'CONNECTED',
    zatcaConnectedAt: status.connectionStatus === 'CONNECTED' ? settings.zatcaConnectedAt ?? new Date() : null,
  }

  if (credential?.egsUnitId) {
    updates.zatcaEgsUnitId = credential.egsUnitId
  }

  await getSettingsRepository().update(settings.id, updates)

  await logZatcaAudit({
    action: 'ENVIRONMENT_CHANGED',
    result: 'SUCCESS',
    message: `Active ZATCA environment changed from ${previous} to ${environment}`,
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { from: previous, to: environment },
  })
}
