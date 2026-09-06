import 'server-only'
import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'
import { logger } from '@/lib/ops/logger'
import { isTerminalEntityStatus } from './snapshot-model'
import { SNAPSHOT_RESOURCES } from './snapshot-resources'
import { extractSnapshotResource } from './snapshot-extractor'
import { writeSnapshotManifest } from './snapshot-manifest'
import { readRawPage } from './snapshot-storage'
import { validateSnapshot } from './snapshot-validation'
import {
  getSnapshot,
  listCheckpoints,
  refreshSnapshotSummary,
  saveSnapshotValidation,
} from './snapshot.service'

const RESOURCE_ORDER = SNAPSHOT_RESOURCES.map((spec) => spec.resourceKey)

export interface SnapshotStepOutcome {
  snapshotId: string
  processedResource: string | null
  snapshotStatus: string
  done: boolean
}

/**
 * Runs one bounded unit of snapshot extraction: pick the next resource that is
 * not terminal, extract a step's worth of raw pages, refresh the summary +
 * manifest, then finalize (validation) when nothing is left.
 *
 * When work remains this returns `done: false` and does NOT schedule the next
 * step itself — the QUICKBOOKS_SNAPSHOT_STEP post-complete hook does that after
 * this step's queue row is durably COMPLETED (see workers.ts), mirroring the
 * QUICKBOOKS_IMPORT_STEP model so the one-active-step index is never contended.
 */
export async function runSnapshotOrchestratorStep(input: {
  provider: AccountingProvider
  context: ProviderAccessContext
  snapshotId: string
  companyId: string
  userId: string
  assertOwned?: () => Promise<void>
}): Promise<SnapshotStepOutcome> {
  const snapshot = await getSnapshot(input.snapshotId, input.companyId)
  if (!snapshot) throw new Error(`Snapshot ${input.snapshotId} not found for company ${input.companyId}.`)
  if (snapshot.status === 'COMPLETE' || snapshot.status === 'FAILED') {
    return { snapshotId: input.snapshotId, processedResource: null, snapshotStatus: snapshot.status, done: true }
  }

  const checkpoints = await listCheckpoints(input.snapshotId)
  const byKey = new Map(checkpoints.map((c) => [c.resourceKey, c]))
  const nextResource = RESOURCE_ORDER.find((key) => {
    const cp = byKey.get(key)
    return cp && (cp.status === 'pending' || cp.status === 'running')
  })

  if (!nextResource) {
    return finalizeSnapshot(input)
  }

  if (input.assertOwned) await input.assertOwned()
  const result = await extractSnapshotResource({
    provider: input.provider,
    context: input.context,
    snapshotId: input.snapshotId,
    companyId: input.companyId,
    storagePrefix: snapshot.storagePrefix,
    resourceKey: nextResource,
  })

  const refreshed = await refreshSnapshotSummary(input.snapshotId)
  await writeSnapshotManifest(refreshed)

  const remaining = (await listCheckpoints(input.snapshotId)).some(
    (cp) => !isTerminalEntityStatus(cp.status),
  )

  if (remaining) {
    logger.info('quickbooks.snapshot.step.done', {
      snapshotId: input.snapshotId,
      processedResource: nextResource,
      status: result.status,
      snapshotStatus: refreshed.status,
    })
    // The post-complete hook schedules the next step once this row is COMPLETED.
    return {
      snapshotId: input.snapshotId,
      processedResource: nextResource,
      snapshotStatus: refreshed.status,
      done: false,
    }
  }

  return finalizeSnapshot(input, nextResource)
}

async function finalizeSnapshot(
  input: { snapshotId: string; companyId: string },
  processedResource: string | null = null,
): Promise<SnapshotStepOutcome> {
  const refreshed = await refreshSnapshotSummary(input.snapshotId)
  const manifest = await writeSnapshotManifest(refreshed)

  const validation = await validateSnapshot(manifest, {
    readPage: (relativeFile) => readRawPage(refreshed.storagePrefix, relativeFile),
  })
  // A snapshot can only be COMPLETE when the summary says COMPLETE AND validation passes.
  const finalStatus =
    refreshed.status === 'COMPLETE' && validation.ok
      ? 'COMPLETE'
      : refreshed.status === 'COMPLETE'
        ? 'PARTIAL'
        : refreshed.status

  await saveSnapshotValidation(input.snapshotId, validation, finalStatus)
  const finalSnapshot = await getSnapshot(input.snapshotId, input.companyId)
  if (finalSnapshot) await writeSnapshotManifest(finalSnapshot)

  logger.info('quickbooks.snapshot.finalized', {
    snapshotId: input.snapshotId,
    status: finalStatus,
    validationOk: validation.ok,
    issues: validation.issues.length,
  })

  return {
    snapshotId: input.snapshotId,
    processedResource,
    snapshotStatus: finalStatus,
    done: true,
  }
}

/**
 * Schedules the first QUICKBOOKS_SNAPSHOT_STEP for a snapshot (create / retry
 * API routes). Continuation between steps is handled by the post-complete hook.
 * Thin wrapper over the shared scheduler so import + snapshot use one model.
 */
export async function enqueueSnapshotStep(input: {
  snapshotId: string
  companyId: string
  userId: string
}): Promise<{ created?: boolean; alreadyActive?: boolean }> {
  const { ensureSnapshotContinuation } = await import('@/lib/platform/continuation-scheduler')
  const outcome = await ensureSnapshotContinuation(input)
  return outcome.created ? { created: true } : { alreadyActive: true }
}
