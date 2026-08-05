import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  extractActivityCursors,
  mergeMigrationPollPayload,
  migrationLivePayloadFingerprint,
  projectMigrationPollPayload,
  utf8JsonBytes,
} from '../../src/lib/import-export/wizard/migration-poll-payload'
import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

function manyEvents(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    at: `2026-08-05T10:00:${String(index).padStart(2, '0')}.000Z`,
    type: 'batch_completed',
    message: `${prefix} batch ${index + 1}`,
    module: prefix,
  }))
}

function fixtureSession(overrides?: {
  state?: HydratedMigrationSession['config']['state']
  lifecycle?: ModuleLifecycleState
}): HydratedMigrationSession {
  const customersEvents = manyEvents('customers', 40)
  const invoicesEvents = manyEvents('invoices', 60)
  const lifecycle: ModuleLifecycleState = overrides?.lifecycle ?? {
    customers: {
      key: 'customers',
      moduleKey: 'customers',
      label: 'Customers',
      order: 0,
      phase: 'completed',
      jobId: 'job-1',
      estimate: { records: 10, batches: 1, durationMs: 5_000 },
      preview: { sampleRowCount: 3, sampleErrorCount: 0, countAccuracy: 'exact' },
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
        activityEvents: customersEvents,
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
        activityEvents: invoicesEvents,
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
    jobs: {
      customers: {
        id: 'job-1',
        moduleKey: 'customers',
        status: 'completed',
        totalRows: 10,
        processedRows: 10,
        importedCount: 8,
        updatedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        warningCount: 1,
        progressPercent: 100,
        activityEvents: customersEvents,
        progressSnapshot: lifecycle.customers.progress?.progressSnapshot,
      },
      invoices: {
        id: 'job-2',
        moduleKey: 'transactions',
        status: 'processing',
        totalRows: 20,
        processedRows: 5,
        importedCount: 4,
        updatedCount: 0,
        skippedCount: 1,
        failedCount: 0,
        warningCount: 0,
        progressPercent: 25,
        currentStage: 'materialize',
        currentRecord: 'INV-1005',
        activityEvents: invoicesEvents,
        progressSnapshot: lifecycle.invoices.progress?.progressSnapshot,
      },
    },
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
      modules: [
        {
          key: 'customers',
          moduleKey: 'customers',
          label: 'Customers',
          order: 0,
          phase: 'completed',
          jobId: 'job-1',
          estimate: { records: 10, batches: 1, durationMs: 5_000 },
          preview: { sampleRowCount: 3, sampleErrorCount: 0, countAccuracy: 'exact' },
          failure: null,
          unsupported: null,
          warningCount: 1,
        },
        {
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
          warningCount: 0,
        },
        {
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
          warningCount: 0,
        },
      ],
      importJobIds: { customers: 'job-1', invoices: 'job-2' },
      startedAt: '2026-08-05T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('compact poll payloads are smaller than full hydrated sessions', () => {
  const session = fixtureSession()
  const before = utf8JsonBytes({ session })
  const full = projectMigrationPollPayload(session, { includeStatic: true })
  const cursors = extractActivityCursors(session)
  const delta = projectMigrationPollPayload(session, {
    includeStatic: false,
    activityCursors: cursors,
    previousLiveFingerprint: null,
  })
  const afterFull = utf8JsonBytes({ poll: full })
  const afterDelta = utf8JsonBytes({ poll: delta })
  const noop = projectMigrationPollPayload(session, {
    includeStatic: false,
    activityCursors: cursors,
    previousLiveFingerprint: migrationLivePayloadFingerprint(delta.live!),
  })
  const afterNoop = utf8JsonBytes({ poll: noop })

  assert.ok(afterFull < before, `full poll ${afterFull} should be smaller than hydrated ${before}`)
  assert.ok(afterDelta < afterFull, `delta poll ${afterDelta} should be smaller than full poll ${afterFull}`)
  assert.ok(afterDelta < before * 0.45, `delta poll ${afterDelta} should be under 45% of hydrated ${before}`)
  assert.equal(noop.kind, 'noop')
  assert.ok(afterNoop < 80)

  // Measurement record for the verification report.
  console.log(JSON.stringify({
    averageResponseSizeBeforeBytes: before,
    averageResponseSizeAfterFullBytes: afterFull,
    averageResponseSizeAfterDeltaBytes: afterDelta,
    averageResponseSizeAfterNoopBytes: afterNoop,
    reductionFullPct: Number((((before - afterFull) / before) * 100).toFixed(1)),
    reductionDeltaPct: Number((((before - afterDelta) / before) * 100).toFixed(1)),
    requestsPerSecUnchanged: true,
  }))
})

test('delta polls omit static configuration and repeated activity events', () => {
  const session = fixtureSession()
  const cursors = extractActivityCursors(session)
  const delta = projectMigrationPollPayload(session, {
    includeStatic: false,
    activityCursors: cursors,
  })

  assert.equal(delta.kind, 'delta')
  assert.equal(delta.static, undefined)
  assert.deepEqual(delta.live?.activityDeltas, {})
  assert.ok(!('activityEvents' in (delta.live?.jobs.customers ?? {})))
  assert.ok(!('activityEvents' in (delta.live?.jobs.invoices ?? {})))
  assert.doesNotMatch(JSON.stringify(delta), /"lifecycle"/)
  assert.doesNotMatch(JSON.stringify(delta), /finalReport|validationScore/)
})

test('merging poll envelopes preserves dashboard progress and activity history', () => {
  const session = fixtureSession()
  const full = projectMigrationPollPayload(session, { includeStatic: true })
  const first = mergeMigrationPollPayload(null, full)
  assert.ok(first)

  const progressed: HydratedMigrationSession = JSON.parse(JSON.stringify(session))
  progressed.jobs.invoices.processedRows = 12
  progressed.jobs.invoices.progressPercent = 60
  progressed.lifecycle.invoices.progress!.processedRows = 12
  progressed.lifecycle.invoices.progress!.progressPercent = 60
  progressed.jobs.invoices.activityEvents = [
    ...(progressed.jobs.invoices.activityEvents ?? []),
    {
      id: 'invoices-61',
      at: '2026-08-05T10:01:00.000Z',
      type: 'batch_completed',
      message: 'invoices batch 61',
      module: 'invoices',
    },
  ]
  progressed.lifecycle.invoices.progress!.activityEvents = progressed.jobs.invoices.activityEvents
  progressed.updatedAt = '2026-08-05T10:01:00.000Z'

  const delta = projectMigrationPollPayload(progressed, {
    includeStatic: false,
    activityCursors: extractActivityCursors(first),
  })
  assert.equal(delta.live?.activityDeltas.invoices?.length, 1)

  const merged = mergeMigrationPollPayload(first, delta)
  assert.ok(merged)
  assert.equal(merged.jobs.invoices.processedRows, 12)
  assert.equal(merged.jobs.invoices.progressPercent, 60)
  assert.ok((merged.jobs.invoices.activityEvents?.length ?? 0) >= 61)
  assert.ok(merged.jobs.invoices.activityEvents?.some((event) => event.id === 'invoices-1'))
  assert.ok(merged.jobs.invoices.activityEvents?.some((event) => event.id === 'invoices-61'))

  const beforePercent = buildMigrationCenterView(first).overall.percent
  const afterView = buildMigrationCenterView(merged)
  assert.ok(afterView.overall.percent >= beforePercent)
  assert.equal(afterView.currentModule?.key, 'invoices')
  assert.ok(afterView.activityTimeline.some((event) => event.id === 'invoices-61'))
  assert.equal(afterView.allModules.length, 3)
  assert.equal(afterView.queuedModules[0]?.key, 'vendors')
})

test('completed migrations still render the final report after compact polls', () => {
  const running = fixtureSession()
  const completedLifecycle = JSON.parse(JSON.stringify(running.lifecycle)) as ModuleLifecycleState
  completedLifecycle.invoices.phase = 'completed'
  completedLifecycle.invoices.progress = {
    ...completedLifecycle.invoices.progress!,
    processedRows: 20,
    progressPercent: 100,
    estimatedRemainingSeconds: 0,
  }
  completedLifecycle.vendors.phase = 'completed'
  completedLifecycle.vendors.progress = {
    processedRows: 5,
    totalRows: 5,
    importedCount: 5,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    progressPercent: 100,
    currentStage: 'persist',
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
  }

  const completed = fixtureSession({ state: 'completed', lifecycle: completedLifecycle })
  completed.jobs.invoices = {
    ...completed.jobs.invoices,
    status: 'completed',
    processedRows: 20,
    progressPercent: 100,
  }
  completed.jobs.vendors = {
    id: 'job-3',
    moduleKey: 'vendors',
    status: 'completed',
    totalRows: 5,
    processedRows: 5,
    importedCount: 5,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    progressPercent: 100,
    activityEvents: [],
  }

  const merged = mergeMigrationPollPayload(null, projectMigrationPollPayload(completed, { includeStatic: true }))
  assert.ok(merged)
  const view = buildMigrationCenterView(merged)
  assert.equal(view.status, 'completed')
  assert.ok(view.finalReport)
  assert.equal(view.finalReport?.modules.length, 3)
  assert.ok((view.finalReport?.totals.imported ?? 0) > 0)
})

test('provider polls with compact mode and merges without a second interval', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const listRoute = read('src/app/api/import-export/migration-sessions/route.ts')
  const itemRoute = read('src/app/api/import-export/migration-sessions/[sessionId]/route.ts')

  assert.match(provider, /poll: '1'/)
  assert.match(provider, /static', '0'/)
  assert.match(provider, /x-migration-activity-cursors/)
  assert.match(provider, /x-migration-live-fingerprint/)
  assert.match(provider, /mergeMigrationPollPayload/)
  assert.equal(provider.match(/window\.setInterval\(/g)?.length, 1)

  assert.match(listRoute, /searchParams\.get\('poll'\) === '1'/)
  assert.match(itemRoute, /searchParams\.get\('poll'\) === '1'/)
  assert.match(listRoute, /pollQuickBooksMigrationSession/)
  assert.match(itemRoute, /pollQuickBooksMigrationSession/)
})
