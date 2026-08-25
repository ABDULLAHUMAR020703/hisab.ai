import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyJobCreated,
  applyJobSnapshot,
  applyPreviewResults,
  initializeModuleLifecycle,
  markModulesPreviewing,
  orderedModules,
} from '../../src/lib/import-export/wizard/module-lifecycle'
import {
  buildSessionConfig,
  importJobIdsFromConfig,
  isActiveMigrationSession,
  isQuickBooksMigrationConfig,
  jobRecordToProgressSnapshot,
  QUICKBOOKS_MIGRATION_SESSION_KIND,
  restoreLifecycleFromSession,
  serializeModuleCards,
} from '../../src/lib/import-export/wizard/migration-session'

const read = (path: string) => readFileSync(path, 'utf8')

const SELECTION = [
  { key: 'accounts', label: 'Chart of Accounts', moduleKey: 'accounts' },
  { key: 'customers', label: 'Customers', moduleKey: 'customers' },
  { key: 'invoices', label: 'Invoices', moduleKey: 'transactions' },
]

function lifecycleReady() {
  return applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION)), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
  ])
}

test('migration session creation stores company-scoped QuickBooks migration metadata', () => {
  const lifecycle = applyJobCreated(lifecycleReady(), 'accounts', 'job-accounts')
  const config = buildSessionConfig({
    selectedModules: SELECTION,
    duplicateStrategy: 'skip',
    lifecycle,
    sourceLabel: 'QuickBooks',
    companyName: 'Sandbox Co',
    currency: 'USD',
  })

  assert.equal(config.kind, QUICKBOOKS_MIGRATION_SESSION_KIND)
  assert.equal(config.provider, 'quickbooks')
  assert.equal(config.state, 'running')
  assert.deepEqual(config.selectedModules.map((module) => module.key), ['accounts', 'customers', 'invoices'])
  assert.equal(config.importJobIds.accounts, 'job-accounts')
  assert.equal(config.modules.length, 3)
  assert.ok(isQuickBooksMigrationConfig(config))
  assert.ok(isActiveMigrationSession({ status: 'IN_PROGRESS', config }))
  assert.equal(isActiveMigrationSession({ status: 'COMPLETED', config }), false)
  assert.equal(isActiveMigrationSession({
    status: 'IN_PROGRESS',
    config: { ...config, state: 'cancelled' },
  }), false)
})

test('session restoration rebuilds selected modules and lifecycle cards from persisted jobs', () => {
  let lifecycle = lifecycleReady()
  lifecycle = applyJobCreated(lifecycle, 'accounts', 'job-1')
  lifecycle = applyJobCreated(lifecycle, 'customers', 'job-2')
  lifecycle = applyJobCreated(lifecycle, 'invoices', 'job-3')
  lifecycle = applyJobSnapshot(lifecycle, 'accounts', {
    status: 'completed',
    processedRows: 90,
    totalRows: 90,
    importedCount: 90,
    progressPercent: 100,
    durationMs: 12_000,
  })
  lifecycle = applyJobSnapshot(lifecycle, 'customers', {
    status: 'processing',
    processedRows: 10,
    totalRows: 26,
    importedCount: 10,
    progressPercent: 38.46,
    currentStage: 'materialization',
    elapsedMs: 4_000,
    averageThroughput: 2.5,
    activityEvents: [{ id: 'evt-1', at: new Date().toISOString(), message: 'Importing customers', type: 'info' }],
  })

  const config = buildSessionConfig({
    selectedModules: SELECTION,
    duplicateStrategy: 'update',
    lifecycle,
    startedAt: '2026-08-05T10:00:00.000Z',
  })

  const jobs = {
    accounts: jobRecordToProgressSnapshot({
      id: 'job-1',
      moduleKey: 'accounts',
      status: 'completed',
      totalRows: 90,
      processedRows: 90,
      importedCount: 90,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      durationMs: 12_000,
    }),
    customers: jobRecordToProgressSnapshot({
      id: 'job-2',
      moduleKey: 'customers',
      status: 'processing',
      totalRows: 26,
      processedRows: 10,
      importedCount: 10,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      progressSnapshot: {
        currentStage: 'materialization',
        averageThroughput: 2.5,
        processedRecords: 10,
        estimatedTotalRecords: 26,
        progressPercent: 38.46,
      },
      activityEvents: [{ id: 'evt-1', at: '2026-08-05T10:01:00.000Z', message: 'Importing customers', type: 'info' }],
    }),
  }

  const restored = restoreLifecycleFromSession(config, jobs)
  const modules = orderedModules(restored)

  assert.deepEqual(modules.map((entry) => entry.key), ['accounts', 'customers', 'invoices'])
  assert.equal(restored.accounts.phase, 'completed')
  assert.equal(restored.customers.phase, 'processing')
  assert.equal(restored.customers.progress?.currentStage, 'materialization')
  assert.equal(restored.customers.progress?.processedRows, 10)
  assert.equal(restored.customers.progress?.averageThroughput, 2.5)
  assert.equal(restored.customers.progress?.activityEvents[0]?.message, 'Importing customers')
  assert.equal(restored.invoices.phase, 'queued')
  assert.equal(restored.invoices.jobId, 'job-3')
  assert.equal(config.duplicateStrategy, 'update')
  assert.deepEqual(importJobIdsFromConfig(config).sort(), ['job-1', 'job-2', 'job-3'])
})

test('browser refresh restores the migration from persisted session state rather than React memory', () => {
  const lifecycle = applyJobSnapshot(
    applyJobCreated(lifecycleReady(), 'accounts', 'job-accounts'),
    'accounts',
    { status: 'processing', processedRows: 40, totalRows: 90, importedCount: 40, progressPercent: 44.44, currentStage: 'extraction' },
  )
  const persisted = buildSessionConfig({
    selectedModules: SELECTION,
    duplicateStrategy: 'skip',
    lifecycle,
    startedAt: '2026-08-05T09:00:00.000Z',
  })

  // Simulate a full page reload: discard the in-memory lifecycle and rebuild only from storage.
  const emptyReactState = {}
  assert.equal(Object.keys(emptyReactState).length, 0)

  const restored = restoreLifecycleFromSession(persisted, {
    accounts: {
      id: 'job-accounts',
      status: 'processing',
      processedRows: 55,
      totalRows: 90,
      importedCount: 55,
      progressPercent: 61.11,
      currentStage: 'materialization',
      activityEvents: [{ id: 'a', at: '2026-08-05T09:05:00.000Z', message: 'Batch complete', type: 'info' }],
      progressSnapshot: { processedRecords: 55, estimatedTotalRecords: 90, currentStage: 'materialization', progressPercent: 61.11 },
    },
  })

  assert.deepEqual(orderedModules(restored).map((entry) => entry.key), ['accounts', 'customers', 'invoices'])
  assert.equal(restored.accounts.phase, 'processing')
  assert.equal(restored.accounts.progress?.processedRows, 55)
  assert.equal(restored.accounts.progress?.currentStage, 'materialization')
  assert.equal(serializeModuleCards(restored).find((card) => card.key === 'customers')?.phase, 'ready')
})

test('duplicate active migration prevention rejects a second running session', () => {
  const config = buildSessionConfig({
    selectedModules: SELECTION,
    duplicateStrategy: 'skip',
    lifecycle: lifecycleReady(),
  })
  assert.ok(isActiveMigrationSession({ status: 'IN_PROGRESS', config }))

  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /Migration already running/)
  assert.match(service, /findActiveQuickBooksMigrationSession/)
  assert.match(service, /createQuickBooksMigrationSession/)
  assert.doesNotMatch(service, /insert\([\s\S]*COA_TEMPLATE/)

  const createRoute = read('src/app/api/import-export/migration-sessions/route.ts')
  assert.match(createRoute, /MIGRATION_ALREADY_RUNNING/)
  assert.match(createRoute, /status: 409/)
  assert.match(createRoute, /findActiveQuickBooksMigrationSession/)
  assert.match(createRoute, /Never creates one/)
})

test('wizard detects active sessions and opens Migration Center instead of inventing progress', () => {
  const wizard = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const center = read('src/components/import-export/MigrationCenter.tsx')

  assert.match(wizard, /\/api\/import-export\/migration-sessions/)
  assert.match(wizard, /Migration already running/)
  assert.match(wizard, /Resume Migration/)
  assert.match(wizard, /Cancel Migration/)
  assert.match(wizard, /data-migration-gate="already-running"/)
  assert.match(wizard, /fetch\('\/api\/import-export\/migration-sessions', \{/)
  assert.doesNotMatch(wizard, /fetch\('\/api\/import-export\/migration-sessions', \{ cache: 'no-store' \}\)/)
  assert.match(wizard, /onSuccessRef\.current\?\.\(runningSessionId\)/)
  assert.match(wizard, /resolveMigrateEntryAction\(persistentSession\)/)
  assert.match(wizard, /Starting Migration Center/)
  // Completed sessions with job ids must not hijack Migrate into a silent close.
  assert.doesNotMatch(wizard, /migrationHasStarted\(persistentSession\.lifecycle\)/)

  assert.match(provider, /includeLatest/)
  assert.match(provider, /poll: '1'/)
  assert.match(provider, /coordinate\(coordinationSignal\)/)
  assert.match(provider, /migrationCenterPath/)
  assert.match(center, /buildMigrationCenterView/)
  assert.doesNotMatch(wizard, /setJobProgress/)
  assert.doesNotMatch(wizard, /moduleStates/)
  assert.doesNotMatch(wizard, /while \(result\.status/)
})

test('session APIs and service use the durable migration session guard', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const cancelRoute = read('src/app/api/import-export/migration-sessions/[sessionId]/cancel/route.ts')
  const patchRoute = read('src/app/api/import-export/migration-sessions/[sessionId]/route.ts')
  const jobService = read('src/lib/import-export/jobs/import-job.service.ts')

  assert.match(service, /from\('migration_wizard_sessions'\)/)
  assert.match(service, /config\.kind === QUICKBOOKS_MIGRATION_SESSION_KIND|isQuickBooksMigrationConfig|kind: QUICKBOOKS_MIGRATION_SESSION_KIND/)
  assert.match(service, /hydrateSession/)
  assert.match(service, /restoreLifecycleFromSession/)
  assert.match(service, /cancelImportJob/)
  assert.match(cancelRoute, /cancelQuickBooksMigrationSession/)
  assert.match(patchRoute, /updateQuickBooksMigrationSession/)
  assert.match(jobService, /export async function getImportJobsByIds/)
  const guard = read('supabase/migrations/066_quickbooks_migration_guards.sql')
  assert.match(guard, /CREATE UNIQUE INDEX IF NOT EXISTS migration_wizard_sessions_one_active_per_company_idx/)
  assert.match(guard, /WHERE status = 'IN_PROGRESS'/)
  assert.match(guard, /config->>'kind' = 'quickbooks_migration'/)
  assert.match(service, /error\.code === '23505'/)
})
