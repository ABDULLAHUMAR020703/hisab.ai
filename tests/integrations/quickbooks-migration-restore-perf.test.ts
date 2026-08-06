import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPaintCachedMigrationSession,
  createMigrationRestoreTimer,
  formatMigrationRestoreBreakdown,
  shouldDeferActivityOnRestore,
  shouldIncludeQueueHealthOnHydrate,
} from '../../src/lib/import-export/wizard/migration-restore-timing'
import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'

test('restore timer records stage durations and total', () => {
  let now = 1_000
  const timer = createMigrationRestoreTimer(() => now)
  timer.mark('route_mount')
  timer.begin('client_fetch')
  now = 1_120
  timer.end('client_fetch')
  timer.begin('client_merge')
  now = 1_145
  timer.end('client_merge')
  now = 1_200
  const report = timer.finalize()
  assert.equal(report.totalMs, 200)
  assert.deepEqual(
    report.stages.map((sample) => sample.stage),
    ['route_mount', 'client_fetch', 'client_merge'],
  )
  assert.equal(report.stages[1]?.ms, 120)
  assert.equal(report.stages[2]?.ms, 25)
  assert.match(formatMigrationRestoreBreakdown(report), /total=200\.0ms/)
  assert.match(formatMigrationRestoreBreakdown(report), /client_fetch=120\.0ms/)
})

test('defer activity on first restore when nothing is cached', () => {
  assert.equal(shouldDeferActivityOnRestore({
    isInitialScopeHydrate: true,
    hasCachedActivity: false,
  }), true)
  assert.equal(shouldDeferActivityOnRestore({
    isInitialScopeHydrate: true,
    hasCachedActivity: true,
  }), false)
  assert.equal(shouldDeferActivityOnRestore({
    isInitialScopeHydrate: false,
    hasCachedActivity: false,
  }), false)
})

test('queue health is skipped for terminal sessions', () => {
  assert.equal(shouldIncludeQueueHealthOnHydrate('running'), true)
  assert.equal(shouldIncludeQueueHealthOnHydrate('completed'), false)
  assert.equal(shouldIncludeQueueHealthOnHydrate('failed'), false)
  assert.equal(shouldIncludeQueueHealthOnHydrate('cancelled'), false)
})

test('cached session matching the route can paint without waiting', () => {
  assert.equal(canPaintCachedMigrationSession({
    routeSessionId: 'sess-1',
    cachedSessionId: 'sess-1',
  }), true)
  assert.equal(canPaintCachedMigrationSession({
    routeSessionId: 'sess-1',
    cachedSessionId: 'sess-2',
  }), false)
  assert.equal(canPaintCachedMigrationSession({
    routeSessionId: 'sess-1',
    cachedSessionId: null,
  }), false)
})

function stubSession(): HydratedMigrationSession {
  const lifecycle: ModuleLifecycleState = {
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
        importedCount: 10,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 100,
        currentStage: 'done',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 1_000,
        throughput: 10,
        averageThroughput: 10,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: [
          {
            id: 'evt-1',
            type: 'module_completed',
            at: '2026-01-01T00:00:10.000Z',
            module: 'Customers',
            message: 'Customers completed',
          },
        ],
        progressSnapshot: {},
      },
      queuePosition: null,
      durationMs: 1_000,
      warningCount: 0,
    },
  }
  return {
    id: 'sess-1',
    companyId: 'co-1',
    userId: 'user-1',
    step: 'report',
    status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:10.000Z',
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state: 'completed',
      duplicateStrategy: 'skip',
      selectedModules: [{ key: 'customers', label: 'Customers', moduleKey: 'customers' }],
      modules: [],
      importJobIds: { customers: 'job-1' },
      sourceLabel: 'QuickBooks',
      companyName: 'Demo',
      currency: 'SAR',
      startedAt: '2026-01-01T00:00:00.000Z',
    },
    jobs: {
      customers: {
        id: 'job-1',
        moduleKey: 'customers',
        status: 'completed',
        processedRows: 10,
        totalRows: 10,
        importedCount: 10,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 100,
        currentStage: 'done',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 1_000,
        throughput: 10,
        averageThroughput: 10,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: lifecycle.customers.progress!.activityEvents,
        progressSnapshot: {},
      },
    },
    lifecycle,
  }
}

test('core Migration Center view skips timeline and report until heavy pass', () => {
  const session = stubSession()
  const core = buildMigrationCenterView(session, Date.parse('2026-01-01T00:00:10.000Z'), {
    includeHeavy: false,
  })
  assert.equal(core.activityTimeline.length, 0)
  assert.equal(core.logs.length, 0)
  assert.equal(core.finalReport, null)
  assert.equal(core.overall.completed, 1)

  const heavy = buildMigrationCenterView(session, Date.parse('2026-01-01T00:00:10.000Z'), {
    includeHeavy: true,
  })
  assert.ok(heavy.activityTimeline.length >= 1)
  assert.ok(heavy.logs.length >= 1)
  assert.ok(heavy.finalReport)
})

test('core view projection stays under a tight CPU budget for restore paint', () => {
  const session = stubSession()
  const started = performance.now()
  for (let i = 0; i < 200; i += 1) {
    buildMigrationCenterView(session, Date.parse('2026-01-01T00:00:10.000Z'), {
      includeHeavy: false,
    })
  }
  const elapsed = performance.now() - started
  assert.ok(elapsed < 250, `expected <250ms for 200 core views, got ${elapsed.toFixed(1)}ms`)
})
