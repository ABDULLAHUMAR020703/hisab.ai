import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { withCompanyContext } from '@/lib/tenant'
import { withExternalRequestDiagnostics } from '@/lib/ops/external-request-diagnostics'
import { logger } from '@/lib/ops/logger'
import type { JobOwnership } from '@/lib/platform/jobs/ownership'
import { runSnapshotOrchestratorStep, type SnapshotStepOutcome } from './snapshot-orchestrator'
import { getSnapshot } from './snapshot.service'

/**
 * Durable worker entry for one QuickBooks snapshot-extraction step.
 * Tenant + realm come from the queue payload and the stored connection —
 * never from Next.js cookies. QuickBooks is only ever read here.
 */
export async function runSnapshotStep(
  snapshotId: string,
  companyId: string,
  userId: string,
  ownership?: JobOwnership,
): Promise<SnapshotStepOutcome> {
  if (ownership) await ownership.assertOwned()
  return withCompanyContext(companyId, async () => {
    const snapshot = await getSnapshot(snapshotId, companyId)
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found for company ${companyId}.`)
    if (snapshot.status === 'COMPLETE' || snapshot.status === 'FAILED') {
      return { snapshotId, processedResource: null, snapshotStatus: snapshot.status, done: true }
    }

    const runtime = createAccountingIntegrationRuntime()
    return runtime.connections.executeForProvider(companyId, Provider.QUICKBOOKS, (context) =>
      withExternalRequestDiagnostics(
        { correlationId: `snapshot-${snapshotId}`, module: 'quickbooks-snapshot', onRequest: () => undefined },
        async () => {
          const provider = runtime.providers.get(Provider.QUICKBOOKS)
          const outcome = await runSnapshotOrchestratorStep({
            provider,
            context,
            snapshotId,
            companyId,
            userId,
            assertOwned: ownership ? () => ownership.assertOwned() : undefined,
          })
          logger.info('quickbooks.snapshot.step.done', {
            snapshotId,
            companyId,
            processedResource: outcome.processedResource,
            snapshotStatus: outcome.snapshotStatus,
            done: outcome.done,
          })
          if (ownership) await ownership.assertOwned()
          return outcome
        },
      ),
    )
  })
}
