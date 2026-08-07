import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildMigrationCenterView,
  migrationCenterPath,
} from '../../src/lib/import-export/wizard/migration-center-view'
import { summarizeMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

function fixtureSession(overrides?: {
  lifecycle?: ModuleLifecycleState
  state?: HydratedMigrationSession['config']['state']
}): HydratedMigrationSession {
  const lifecycle: ModuleLifecycleState = overrides?.lifecycle ?? {
    customers: {
      key: 'customers',
      moduleKey: 'customers',
      label: 'Customers',
      order: 0,
      phase: 'completed',
      jobId: 'job-1',
      estimate: { records: 10, batches: 1, durationMs: 5_000 },
      preview: null,
      failure: null,
      unsupported: null,
      progress: {
        processedRows: 10,
        totalRows: 10,
        importedCount: 8,
        updatedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        progressPercent: 100,
        currentStage: 'persist',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 4_000,
        throughput: 2.5,
        averageThroughput: 2.5,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: [
          { id: 'e1', at: '2026-08-05T10:00:01.000Z', type: 'batch_completed', message: 'Imported customer batch', module: 'Customers' },
        ],
        progressSnapshot: {
          apiRequests: 3,
          databaseQueries: 12,
          databaseWrites: 8,
          databaseTimeMs: 400,
          retryCount: 0,
          memoryBytes: 12_000_000,
          stages: { persist: { status: 'completed', durationMs: 1200, progress: 100 } },
        },
      },
      queuePosition: null,
      durationMs: 4_000,
      warningCount: 1,
    },
    invoices: {
      key: 'invoices',
      moduleKey: 'transactions',
      label: 'Invoices',
      order: 1,
      phase: 'processing',
      jobId: 'job-2',
      estimate: { records: 20, batches: 2, durationMs: 10_000 },
      preview: null,
      failure: null,
      unsupported: null,
      progress: {
        processedRows: 5,
        totalRows: 20,
        importedCount: 4,
        updatedCount: 0,
        skippedCount: 1,
        failedCount: 0,
        progressPercent: 25,
        currentStage: 'materialize',
        currentRecord: 'INV-1005',
        currentBatch: 1,
        totalBatches: 2,
        elapsedMs: 2_000,
        throughput: 2,
        averageThroughput: 2,
        estimatedRemaining: 15,
        estimatedRemainingSeconds: 8,
        estimatedCompletionAt: null,
        activityEvents: [
          { id: 'e2', at: '2026-08-05T10:00:05.000Z', type: 'stage_started', message: 'Materializing invoices', module: 'Invoices' },
        ],
        progressSnapshot: {
          apiRequests: 5,
          databaseQueries: 20,
          databaseWrites: 4,
          databaseTimeMs: 800,
          retryCount: 1,
          memoryBytes: 20_000_000,
          stages: { materialize: { status: 'running', progress: 40 } },
        },
      },
      queuePosition: null,
      durationMs: null,
      warningCount: 0,
    },
    vendors: {
      key: 'vendors',
      moduleKey: 'vendors',
      label: 'Vendors',
      order: 2,
      phase: 'queued',
      jobId: null,
      estimate: { records: 5, batches: 1, durationMs: 3_000 },
      preview: null,
      failure: null,
      unsupported: null,
      progress: null,
      queuePosition: 1,
      durationMs: null,
      warningCount: 0,
    },
  }

  const state = overrides?.state ?? 'running'
  return {
    id: 'session-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: state === 'completed' ? 'report' : 'import',
    status: state === 'running' ? 'IN_PROGRESS' : 'COMPLETED',
    createdAt: '2026-08-05T09:59:00.000Z',
    updatedAt: '2026-08-05T10:00:10.000Z',
    jobs: {},
    lifecycle,
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state,
      selectedModules: [
        { key: 'customers', label: 'Customers', moduleKey: 'customers' },
        { key: 'invoices', label: 'Invoices', moduleKey: 'transactions' },
        { key: 'vendors', label: 'Vendors', moduleKey: 'vendors' },
      ],
      duplicateStrategy: 'skip',
      modules: [],
      importJobIds: { customers: 'job-1', invoices: 'job-2' },
      startedAt: '2026-08-05T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('migration history lists sessions from persisted backend API', () => {
  const page = read('src/app/(dashboard)/migration-history/page.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const route = read('src/app/api/import-export/migration-sessions/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const layout = read('src/app/(dashboard)/layout.tsx')

  assert.match(page, /data-migration-history/)
  assert.match(page, /loadHistory/)
  assert.doesNotMatch(page, /fetch\(/)
  assert.match(provider, /list: 'true'/)
  assert.match(page, /View Report/)
  assert.match(page, /View Logs/)
  assert.match(page, /Imported/)
  assert.match(page, /Updated/)
  assert.match(page, /Skipped/)
  assert.match(page, /Failed/)
  assert.match(page, /Warnings/)
  assert.match(route, /searchParams\.get\('list'\) === 'true'/)
  assert.match(route, /listQuickBooksMigrationSessions/)
  assert.match(service, /listQuickBooksMigrationSessions/)
  assert.match(service, /summarizeMigrationSession/)
  assert.match(layout, /Migration History/)
  assert.match(layout, /\/migration-history/)
})

test('historical reports reopen through Migration Center anchors', () => {
  const page = read('src/app/(dashboard)/migration-history/page.tsx')
  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(page, /migrationCenterPath\(item\.id\)\}#final-report/)
  assert.match(page, /migrationCenterPath\(item\.id\)\}#logs/)
  assert.match(center, /id="final-report"/)
  assert.match(center, /id="logs"/)
  assert.match(center, /Final Report/)
  assert.equal(migrationCenterPath('abc'), '/migration-center/abc')
})

test('dashboard restoration derives overview from hydrated session only', () => {
  const view = buildMigrationCenterView(fixtureSession())
  assert.equal(view.sessionId, 'session-1')
  assert.equal(view.status, 'running')
  assert.equal(view.currentModule?.key, 'invoices')
  assert.equal(view.currentStage, 'materialize')
  assert.equal(view.currentRecord, 'INV-1005')
  assert.equal(view.currentBatch, 1)
  assert.equal(view.completedModules.length, 1)
  assert.equal(view.queuedModules.length, 1)
  assert.equal(view.processingModules.length, 1)
  assert.ok(view.overall.percent > 0)
  assert.ok(view.elapsedMs > 0)
  assert.equal(view.workerStatus, 'processing')
  assert.equal(view.queueStatus.depth, 1)
  assert.equal(view.queueStatus.nextLabel, 'Vendors')

  const page = read('src/app/(dashboard)/migration-center/[sessionId]/page.tsx')
  const center = read('src/components/import-export/MigrationCenter.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  assert.match(page, /session: contextSession/)
  assert.doesNotMatch(page, /fetch\(/)
  assert.match(provider, /\/api\/import-export\/migration-sessions\/\$\{encodeURIComponent\(sessionId\)\}\?\$\{params\}/)
  assert.match(provider, /poll: '1'/)
  assert.match(provider, /cache: 'no-store'/)
  assert.match(page, /MigrationCenterSkeleton/)
  assert.match(center, /Restoring migration from persisted session/)
  assert.doesNotMatch(page, /useState\(\{[\s\S]*percent/)
})

test('activity timeline restoration uses persisted activity events', () => {
  const view = buildMigrationCenterView(fixtureSession())
  assert.ok(view.activityTimeline.some((event) => event.id === 'e2'))
  assert.ok(view.activityTimeline.some((event) => event.message.includes('Materializing')))
  assert.ok(view.logs.length >= 2)

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /Activity Timeline/)
  assert.match(center, /view\.activityTimeline/)
})

test('module restoration keeps completed, queued, processing, and failed buckets', () => {
  const failedLifecycle = fixtureSession().lifecycle
  failedLifecycle.vendors = {
    ...failedLifecycle.vendors,
    phase: 'failed',
    failure: {
      message: 'Vendor sync failed',
      stage: 'fetch',
      errorCode: 'QB_FAIL',
      correlationId: 'c-1',
      retryable: true,
    },
    queuePosition: null,
  }
  const view = buildMigrationCenterView(fixtureSession({ lifecycle: failedLifecycle }))
  assert.equal(view.completedModules.map((entry) => entry.key).join(','), 'customers')
  assert.equal(view.processingModules.map((entry) => entry.key).join(','), 'invoices')
  assert.equal(view.failedModules.map((entry) => entry.key).join(','), 'vendors')
  assert.equal(view.errors[0]?.errorCode, 'QB_FAIL')

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /Completed Modules/)
  assert.match(center, /Queued Modules/)
  assert.match(center, /Processing Modules/)
  assert.match(center, /Failed Modules/)
})

test('performance metrics restoration reads progressSnapshot from jobs', () => {
  const view = buildMigrationCenterView(fixtureSession())
  assert.equal(view.performance.apiRequests, 5)
  assert.equal(view.performance.databaseQueries, 20)
  assert.equal(view.performance.databaseWrites, 4)
  assert.equal(view.performance.retryCount, 1)
  assert.equal(view.performance.averageThroughput, 2.5)

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /Performance Metrics/)
  assert.match(center, /view\.performance\.apiRequests/)
})

test('wizard is configuration-only after migration starts', () => {
  const wizard = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const page = read('src/app/(dashboard)/migration-wizard/page.tsx')

  assert.doesNotMatch(wizard, /function MigrationDashboard/)
  assert.match(wizard, /Starting Migration Center/)
  assert.match(wizard, /onSuccess\?\.\(createdSession\.session\.id\)/)
  assert.match(provider, /migrationCenterPath/)
  assert.match(provider, /openMigrationCenter/)
  assert.match(provider, /navigateOnce\(migrationCenterPath/)
  assert.match(page, /Configure Migration/)
})

test('history summary is derived from persisted session hydration', () => {
  const completed = fixtureSession({
    state: 'completed',
    lifecycle: {
      customers: {
        ...fixtureSession().lifecycle.customers,
        phase: 'completed',
      },
      invoices: {
        ...fixtureSession().lifecycle.invoices,
        phase: 'completed',
        progress: {
          ...fixtureSession().lifecycle.invoices.progress!,
          processedRows: 20,
          progressPercent: 100,
          estimatedRemainingSeconds: 0,
        },
        durationMs: 9_000,
      },
      vendors: {
        ...fixtureSession().lifecycle.vendors,
        phase: 'completed',
        jobId: 'job-3',
        progress: {
          processedRows: 5,
          totalRows: 5,
          importedCount: 5,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          progressPercent: 100,
          currentStage: 'done',
          currentRecord: null,
          currentBatch: 1,
          totalBatches: 1,
          elapsedMs: 1_000,
          throughput: 5,
          averageThroughput: 5,
          estimatedRemaining: 0,
          estimatedRemainingSeconds: 0,
          estimatedCompletionAt: null,
          activityEvents: [],
          progressSnapshot: {},
        },
        durationMs: 1_000,
        queuePosition: null,
      },
    },
  })
  const summary = summarizeMigrationSession(completed)
  assert.equal(summary.provider, 'quickbooks')
  assert.equal(summary.status, 'completed')
  assert.equal(summary.moduleCount, 3)
  assert.ok(summary.importedCount >= 8)
  assert.equal(summary.warningCount, 1)
  assert.ok(summary.completedAt)
})
