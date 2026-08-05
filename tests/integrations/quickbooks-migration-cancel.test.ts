import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  canCancelMigrationSession,
  MIGRATION_CANCEL_CONFIRMATION,
  migrationCancelConfirmMessage,
  planGracefulMigrationCancel,
  planResumeAfterCancellation,
} from '../../src/lib/import-export/wizard/migration-cancel'
import {
  applyJobCreated,
  applyJobSnapshot,
  applyPreviewResults,
  initializeModuleLifecycle,
  markModulesPreviewing,
} from '../../src/lib/import-export/wizard/module-lifecycle'
import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import {
  buildSessionConfig,
  summarizeMigrationSession,
  type HydratedMigrationSession,
} from '../../src/lib/import-export/wizard/migration-session'

const read = (path: string) => readFileSync(path, 'utf8')

const SELECTION = [
  { key: 'accounts', label: 'Chart of Accounts', moduleKey: 'accounts' },
  { key: 'customers', label: 'Customers', moduleKey: 'customers' },
  { key: 'invoices', label: 'Invoices', moduleKey: 'transactions' },
]

function readyLifecycle() {
  return applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION)), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
  ])
}

function queuedMigration() {
  let lifecycle = readyLifecycle()
  for (const key of ['accounts', 'customers', 'invoices']) {
    lifecycle = applyJobCreated(lifecycle, key, `job-${key}`)
  }
  return lifecycle
}

function processingMigration() {
  let lifecycle = queuedMigration()
  lifecycle = applyJobSnapshot(lifecycle, 'accounts', {
    status: 'completed',
    processedRows: 90,
    totalRows: 90,
    importedCount: 90,
    progressPercent: 100,
    durationMs: 12_000,
    activityEvents: [{ id: 'a1', at: '2026-08-05T10:00:00.000Z', message: 'Accounts done', type: 'info' }],
  })
  lifecycle = applyJobSnapshot(lifecycle, 'customers', {
    status: 'processing',
    processedRows: 10,
    totalRows: 26,
    importedCount: 10,
    progressPercent: 38,
    currentStage: 'materialization',
    activityEvents: [{ id: 'c1', at: '2026-08-05T10:01:00.000Z', message: 'Customer batch', type: 'info' }],
    progressSnapshot: { processedRecords: 10, currentStage: 'materialization' },
  })
  return lifecycle
}

test('cancel while queued cancels every not-started module and job', () => {
  const lifecycle = queuedMigration()
  const jobs = {
    accounts: { id: 'job-accounts', status: 'pending' },
    customers: { id: 'job-customers', status: 'pending' },
    invoices: { id: 'job-invoices', status: 'pending' },
  }

  const plan = planGracefulMigrationCancel(lifecycle, jobs)

  assert.deepEqual(plan.cancelJobIds.sort(), ['job-accounts', 'job-customers', 'job-invoices'])
  assert.deepEqual(plan.preserveJobIds, [])
  assert.equal(plan.lifecycle.accounts.phase, 'cancelled')
  assert.equal(plan.lifecycle.customers.phase, 'cancelled')
  assert.equal(plan.lifecycle.invoices.phase, 'cancelled')
  assert.match(plan.lifecycle.customers.failure?.message ?? '', /finish its active batch/)
  assert.equal(canCancelMigrationSession('running'), true)
})

test('cancel while processing preserves the active job and cancels queued modules', () => {
  const lifecycle = processingMigration()
  const jobs = {
    accounts: { id: 'job-accounts', status: 'completed' },
    customers: { id: 'job-customers', status: 'processing' },
    invoices: { id: 'job-invoices', status: 'pending' },
  }

  const plan = planGracefulMigrationCancel(lifecycle, jobs)

  assert.deepEqual(plan.preserveJobIds, ['job-customers'])
  assert.deepEqual(plan.cancelJobIds, ['job-invoices'])
  assert.equal(plan.lifecycle.accounts.phase, 'completed')
  assert.equal(plan.lifecycle.customers.phase, 'processing')
  assert.equal(plan.lifecycle.customers.progress?.processedRows, 10)
  assert.equal(plan.lifecycle.customers.progress?.activityEvents[0]?.message, 'Customer batch')
  assert.equal(plan.lifecycle.invoices.phase, 'cancelled')
})

test('cancel treats paused work as resumable cancellation, not an active transaction', () => {
  let lifecycle = queuedMigration()
  lifecycle = applyJobSnapshot(lifecycle, 'accounts', {
    status: 'paused',
    processedRows: 10,
    totalRows: 90,
    importedCount: 10,
    progressPercent: 11,
  })

  const plan = planGracefulMigrationCancel(lifecycle, {
    accounts: { id: 'job-accounts', status: 'paused' },
    customers: { id: 'job-customers', status: 'pending' },
    invoices: { id: 'job-invoices', status: 'pending' },
  })

  assert.deepEqual(plan.preserveJobIds, [])
  assert.deepEqual(plan.cancelJobIds.sort(), ['job-accounts', 'job-customers', 'job-invoices'])
})

test('cancel after completion is disabled', () => {
  assert.equal(canCancelMigrationSession('completed'), false)
  assert.equal(canCancelMigrationSession('cancelled'), false)
  assert.equal(canCancelMigrationSession('failed'), false)
  assert.equal(canCancelMigrationSession('running'), true)

  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /Completed migrations cannot be cancelled/)
  assert.match(service, /canCancelMigrationSession/)
  assert.match(service, /planGracefulMigrationCancel/)
  assert.match(service, /cancelPendingContinuationJobs/)
  assert.doesNotMatch(
    service.slice(service.indexOf('export async function cancelQuickBooksMigrationSession')),
    /for \(const jobId of jobIds\) \{\s*await cancelImportJob/,
  )

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /view\.canCancel && onCancel/)
  assert.doesNotMatch(center, /view\.status === 'completed'[\s\S]{0,200}Cancel Migration/)
})

test('resume after cancellation re-queues cancelled modules and preserves completed work', () => {
  const lifecycle = processingMigration()
  const jobs = {
    accounts: { id: 'job-accounts', status: 'completed' },
    customers: { id: 'job-customers', status: 'processing' },
    invoices: { id: 'job-invoices', status: 'pending' },
  }
  const cancelled = planGracefulMigrationCancel(lifecycle, jobs).lifecycle
  // Simulate the active module finishing its batch as cancelled after session cancel.
  const afterBatch = applyJobSnapshot(cancelled, 'customers', {
    status: 'cancelled',
    processedRows: 10,
    totalRows: 26,
    importedCount: 10,
    progressPercent: 38,
    activityEvents: [{ id: 'c1', at: '2026-08-05T10:01:00.000Z', message: 'Customer batch', type: 'info' }],
    progressSnapshot: { processedRecords: 10, currentStage: 'materialization' },
  })

  const resumed = planResumeAfterCancellation(afterBatch)
  assert.equal(resumed.accounts.phase, 'completed')
  assert.equal(resumed.accounts.progress?.importedCount, 90)
  assert.equal(resumed.customers.phase, 'queued')
  assert.equal(resumed.customers.jobId, 'job-customers')
  assert.equal(resumed.customers.progress?.processedRows, 10)
  assert.equal(resumed.customers.failure, null)
  assert.equal(resumed.invoices.phase, 'queued')
  assert.equal(resumed.invoices.failure, null)

  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /planResumeAfterCancellation/)
  assert.match(service, /job\.status === 'failed' \|\| job\.status === 'cancelled'/)
  assert.match(service, /No failed or cancelled migration jobs are available to resume/)
})

test('continuation gates stop before the next claim without redesigning the worker', () => {
  const importRoute = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(importRoute, /isImportJobMigrationCancelled/)
  assert.match(importRoute, /sessionCancelled/)
  assert.match(importRoute, /status: 'cancelled'/)
  assert.match(importRoute, /Already-queued continuations must not start a new batch after session cancel/)
  assert.match(importRoute, /Persist its source[\s\S]*await sourcePage\.commit\(\)/)
  // Mid-batch cancel still relies on import job status — graceful cancel does not flip it early.
  assert.match(importRoute, /isCancelled: \(\) => isJobCancelled\(job\.id\)/)
  assert.doesNotMatch(importRoute, /claimNextJob/)
})

test('Migration Center and indicator expose confirmed Cancel Migration actions', () => {
  assert.match(MIGRATION_CANCEL_CONFIRMATION, /finish its active batch before stopping/)
  assert.match(MIGRATION_CANCEL_CONFIRMATION, /Completed modules will remain available/)
  assert.match(migrationCancelConfirmMessage(), /Cancel Migration/)

  const centerPage = read('src/app/(dashboard)/migration-center/[sessionId]/page.tsx')
  assert.match(centerPage, /migrationCancelConfirmMessage/)
  assert.match(centerPage, /window\.confirm/)

  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  assert.match(provider, /data-cancel-migration/)
  assert.match(provider, /Cancel Migration/)
  assert.match(provider, /migrationCancelConfirmMessage/)

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /Cancelled Modules/)
  assert.match(center, /Remaining Modules Not Executed/)
  assert.match(center, /Resume Migration/)
})

test('history and center surfaces report Cancelled status with preserved modules', () => {
  const lifecycle = planGracefulMigrationCancel(processingMigration(), {
    accounts: { id: 'job-accounts', status: 'completed' },
    customers: { id: 'job-customers', status: 'processing' },
    invoices: { id: 'job-invoices', status: 'pending' },
  }).lifecycle

  const config = buildSessionConfig({
    selectedModules: SELECTION,
    duplicateStrategy: 'skip',
    lifecycle,
    state: 'cancelled',
    startedAt: '2026-08-05T10:00:00.000Z',
  })
  const session: HydratedMigrationSession = {
    id: 'sess-1',
    companyId: 'co-1',
    userId: 'user-1',
    step: 'import',
    status: 'CANCELLED',
    config,
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:05:00.000Z',
    jobs: {},
    lifecycle,
  }

  const summary = summarizeMigrationSession(session)
  assert.equal(summary.status, 'cancelled')

  const view = buildMigrationCenterView(session)
  assert.equal(view.status, 'cancelled')
  assert.equal(view.canCancel, false)
  assert.deepEqual(view.completedModules.map((entry) => entry.key), ['accounts'])
  assert.deepEqual(view.cancelledModules.map((entry) => entry.key), [])
  assert.deepEqual(view.remainingModules.map((entry) => entry.key), ['invoices'])
  assert.deepEqual(view.processingModules.map((entry) => entry.key), ['customers'])
  assert.equal(view.cancellingActiveBatch, true)
  assert.deepEqual(view.allModules.map((entry) => entry.key), ['accounts', 'customers', 'invoices'])

  const history = read('src/app/(dashboard)/migration-history/page.tsx')
  assert.match(history, /Cancelled/)
  assert.match(history, /STATUS_LABEL/)
})
