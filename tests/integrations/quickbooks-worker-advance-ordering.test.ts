import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { planMigrationStartBootstrap } from '../../src/lib/import-export/wizard/migration-session-bootstrap'
import {
  isTerminalImportJobStatus,
  restoreLifecycleFromSession,
  shouldAdvanceToNextMigrationModule,
} from '../../src/lib/import-export/wizard/migration-session'
import { mergeImportJobProgress } from '../../src/lib/import-export/jobs/progress-merge'
import { orderQuickBooksMigrationResources } from '../../src/lib/import-export/quickbooks/dependency-order'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type {
  ModuleLifecycleEntry,
  ModuleLifecyclePhase,
  ModuleLifecycleState,
} from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function moduleEntry(
  key: string,
  order: number,
  phase: ModuleLifecyclePhase,
  jobId: string | null,
): ModuleLifecycleEntry {
  return {
    key,
    moduleKey: `qb-${key}`,
    label: key,
    order,
    phase,
    jobId,
    estimate: { records: 1, batches: 1, durationMs: 1_000 },
    preview: null,
    failure: null,
    unsupported: null,
    progress: null,
    queuePosition: null,
    durationMs: null,
    warningCount: 0,
  }
}

function preferencesThenAccountsSession(jobStatus: string): HydratedMigrationSession {
  const resources = orderQuickBooksMigrationResources([
    { key: 'preferences', label: 'Company Preferences', moduleKey: 'qb-preferences' },
    { key: 'accounts', label: 'Accounts', moduleKey: 'qb-accounts' },
  ])
  const lifecycle: ModuleLifecycleState = {
    preferences: moduleEntry('preferences', 0, jobStatus === 'completed' ? 'completed' : 'processing', 'pref-job'),
    accounts: moduleEntry('accounts', 1, 'ready', null),
  }
  const jobs = {
    preferences: {
      id: 'pref-job',
      moduleKey: 'qb-preferences',
      status: jobStatus,
      totalRows: 1,
      processedRows: jobStatus === 'completed' ? 1 : 0,
      importedCount: jobStatus === 'completed' ? 1 : 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: jobStatus === 'failed' ? 1 : 0,
    },
  }
  const config = {
    kind: 'quickbooks_migration' as const,
    provider: 'quickbooks' as const,
    state: 'running' as const,
    selectedModules: resources,
    duplicateStrategy: 'skip' as const,
    modules: Object.values(lifecycle).map((entry) => ({
      key: entry.key,
      moduleKey: entry.moduleKey,
      label: entry.label,
      order: entry.order,
      phase: entry.phase,
      jobId: entry.jobId,
      estimate: entry.estimate,
      preview: entry.preview,
      failure: entry.failure,
      unsupported: entry.unsupported,
      warningCount: entry.warningCount,
    })),
    importJobIds: { preferences: 'pref-job' },
    startedAt: '2026-08-06T15:43:25.531Z',
    sourceLabel: 'QuickBooks Online',
    companyName: 'Sandbox Co',
    currency: 'USD',
    orchestrationOwner: 'worker' as const,
  }
  const restored = restoreLifecycleFromSession(config, jobs)
  return {
    id: 'session-advance-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: 'IN_PROGRESS',
    createdAt: '2026-08-06T15:43:25.648Z',
    updatedAt: '2026-08-06T15:43:25.648Z',
    lifecycle: restored,
    jobs,
    config,
  }
}

test('persisted terminal status is required before advancement, handler return is not enough', () => {
  assert.equal(isTerminalImportJobStatus('processing'), false)
  assert.equal(isTerminalImportJobStatus('pending'), false)
  assert.equal(isTerminalImportJobStatus('paused'), false)
  assert.equal(isTerminalImportJobStatus('completed'), true)
  assert.equal(isTerminalImportJobStatus('failed'), true)
  assert.equal(isTerminalImportJobStatus('cancelled'), true)

  const workers = read('src/lib/platform/jobs/workers.ts')
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  const helper = workers.slice(
    workers.indexOf('async function coordinateQuickBooksMigrationAfterStep'),
    workers.indexOf("registerJobHandler('EMAIL_SEND'"),
  )
  const handler = workers.slice(
    workers.indexOf("registerJobHandler('QUICKBOOKS_IMPORT_STEP'"),
    workers.indexOf("registerJobHandler('AUTOMATION_RUN'"),
  )

  assert.match(route, /orchestrationStep\('finalize'/)
  assert.match(route, /finalizeImportJob\(/)
  assert.ok(route.indexOf("orchestrationStep('finalize'") < route.indexOf("orchestrationStep('finalized'"))
  assert.match(helper, /getImportJob\(input\.importJobId, input\.companyId\)/)
  assert.match(helper, /isTerminalImportJobStatus\(job\.status\)/)
  assert.match(helper, /terminal_status_persisted/)
  assert.ok(helper.indexOf('getImportJob') < helper.indexOf('advanceQuickBooksMigrationAfterImportJob'))
  assert.ok(helper.indexOf('isTerminalImportJobStatus') < helper.indexOf('advanceQuickBooksMigrationAfterImportJob'))
  assert.match(handler, /await runImportJobStep\(/)
  assert.match(handler, /coordinateQuickBooksMigrationAfterStep\(/)
  assert.ok(handler.indexOf('runImportJobStep') < handler.indexOf('coordinateQuickBooksMigrationAfterStep'))
})

test('advance reads persisted import_jobs.status before hydrating the session', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const advance = service.slice(
    service.indexOf('export async function advanceQuickBooksMigrationAfterImportJob'),
    service.indexOf('export async function updateQuickBooksMigrationSession'),
  )
  const statusSelect = advance.indexOf("select('id,migration_session_id,status')")
  const terminalGuard = advance.indexOf('isTerminalImportJobStatus(persistedStatus)')
  const hydrate = advance.indexOf('hydrateSession(mapSessionRow(row)')
  const laterGuard = advance.indexOf('isTerminalImportJobStatus(finished.status)')

  assert.ok(statusSelect >= 0)
  assert.ok(terminalGuard > statusSelect)
  assert.ok(hydrate > terminalGuard)
  assert.ok(laterGuard > hydrate)
  assert.match(advance, /reason: 'import_job_not_terminal'/)
})

test('a completed qb-preferences job creates and enqueues the next accounts job', () => {
  const session = preferencesThenAccountsSession('completed')
  const plan = planMigrationStartBootstrap(session)
  assert.equal(shouldAdvanceToNextMigrationModule('completed'), true)
  assert.equal(plan.type, 'create-and-enqueue')
  if (plan.type === 'create-and-enqueue') {
    assert.equal(plan.module.key, 'accounts')
    assert.equal(plan.module.moduleKey, 'qb-accounts')
  }

  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const advance = service.slice(
    service.indexOf('export async function advanceQuickBooksMigrationAfterImportJob'),
    service.indexOf('export async function updateQuickBooksMigrationSession'),
  )
  assert.match(advance, /shouldAdvanceToNextMigrationModule\(finished\.status\)/)
  assert.match(advance, /bootstrapQuickBooksMigrationQueue\(\{ session, userId, companyIdOverride: companyId \}\)/)
  const bootstrapCall = advance.indexOf('bootstrapQuickBooksMigrationQueue')
  const failedReturn = advance.indexOf('shouldAdvanceToNextMigrationModule(finished.status)')
  assert.ok(failedReturn >= 0 && bootstrapCall > failedReturn)
})

test('a failed job stays failed and does not advance to the next module', () => {
  assert.equal(isTerminalImportJobStatus('failed'), true)
  assert.equal(shouldAdvanceToNextMigrationModule('failed'), false)
  assert.equal(planMigrationStartBootstrap(preferencesThenAccountsSession('failed')).type, 'none')

  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const advance = service.slice(
    service.indexOf('export async function advanceQuickBooksMigrationAfterImportJob'),
    service.indexOf('export async function updateQuickBooksMigrationSession'),
  )
  const failedBranch = advance.slice(advance.indexOf('shouldAdvanceToNextMigrationModule(finished.status)'))
  assert.match(failedBranch, /reconcileQuickBooksMigrationSession\(session\)/)
  assert.ok(failedBranch.indexOf('return') < failedBranch.indexOf('bootstrapQuickBooksMigrationQueue'))
})

test('retrying a completed job remains idempotent and does not grow processedRows', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  const jobs = read('src/lib/import-export/jobs/import-job.service.ts')
  const step = route.slice(route.indexOf('export async function runImportJobStep'))

  assert.match(step, /terminal_replay_skipped/)
  assert.ok(step.indexOf('terminal_replay_skipped') < step.indexOf("setImportJobStatus(job.id, 'processing'"))
  assert.match(jobs, /completed_job_immutable/)
  assert.match(jobs, /\.neq\('status', 'completed'\)/)
  assert.equal(mergeImportJobProgress({
    status: 'completed',
    processedRows: 4,
    totalRows: 4,
    importedCount: 4,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    validRows: 4,
    invalidRows: 0,
    warningCount: 0,
    progressSnapshot: { processedRecords: 4, estimatedTotalRecords: 4, importedCount: 4 },
  }, {
    processedRows: 8,
    totalRows: 4,
    counts: { importedCount: 8 },
    progressSnapshot: { processedRecords: 8, importedCount: 8 },
  }), 'stale_completed')
})

test('the worker path still uses explicit companyId and never cookies or headers', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const jobs = read('src/lib/import-export/jobs/import-job.service.ts')
  const helper = workers.slice(
    workers.indexOf('async function coordinateQuickBooksMigrationAfterStep'),
    workers.indexOf("registerJobHandler('EMAIL_SEND'"),
  )
  const handler = workers.slice(
    workers.indexOf("registerJobHandler('QUICKBOOKS_IMPORT_STEP'"),
    workers.indexOf("registerJobHandler('AUTOMATION_RUN'"),
  )

  assert.match(handler, /withCompanyContext\(companyId/)
  assert.match(helper, /getImportJob\(input\.importJobId, input\.companyId\)/)
  assert.match(jobs, /resolveCompanyIdOrThrow\(input\.companyId\)/)
  assert.doesNotMatch(workers, /from 'next\/headers'/)
  assert.doesNotMatch(handler, /cookies\(/)
  assert.doesNotMatch(handler, /headers\(/)
  assert.doesNotMatch(helper, /cookies\(/)
  assert.doesNotMatch(helper, /headers\(/)
})
