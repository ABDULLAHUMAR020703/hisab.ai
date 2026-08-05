import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildMigrationActivityTimeline } from '../../src/lib/import-export/wizard/migration-activity-timeline'
import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import {
  mergeMigrationPollPayload,
  projectMigrationPollPayload,
} from '../../src/lib/import-export/wizard/migration-poll-payload'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { ModuleLifecycleEntry, ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

function moduleEntry(
  key: string,
  label: string,
  order: number,
  phase: ModuleLifecycleEntry['phase'],
  jobId: string,
): ModuleLifecycleEntry {
  return {
    key,
    moduleKey: key,
    label,
    order,
    phase,
    jobId,
    estimate: null,
    preview: null,
    failure: null,
    unsupported: null,
    progress: null,
    queuePosition: null,
    durationMs: null,
    warningCount: 0,
  }
}

function fixtureSession(): HydratedMigrationSession {
  const lifecycle: ModuleLifecycleState = {
    vendors: {
      ...moduleEntry('vendors', 'Vendors', 0, 'completed_with_warnings', 'job-vendors'),
      durationMs: 240_000,
      warningCount: 2,
      progress: {
        processedRows: 26,
        totalRows: 26,
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 26,
        failedCount: 0,
        progressPercent: 100,
        currentStage: 'report_generation',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 240_000,
        throughput: 0.1,
        averageThroughput: 0.1,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: [
          {
            id: 'vendors-fetched',
            at: '2026-08-05T21:06:00.000Z',
            type: 'batch_completed',
            message: 'Completed batch 1',
            module: 'Vendors',
            stage: 'extraction',
            batch: 1,
            records: 26,
          },
          {
            id: 'vendors-duplicates',
            at: '2026-08-05T21:07:00.000Z',
            type: 'stage_completed',
            message: 'Completed duplicate detection',
            module: 'Vendors',
            stage: 'duplicate_detection',
            durationMs: 1_500,
          },
        ],
        progressSnapshot: {
          activeProcessingMs: 240_000,
          stages: {
            duplicate_detection: { status: 'completed', durationMs: 1_500 },
          },
        },
      },
    },
    products: {
      ...moduleEntry('products', 'Products & Services', 1, 'processing', 'job-products'),
      progress: {
        processedRows: 0,
        totalRows: 40,
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 0,
        currentStage: 'extraction',
        currentRecord: null,
        currentBatch: 0,
        totalBatches: 1,
        elapsedMs: 0,
        throughput: null,
        averageThroughput: null,
        estimatedRemaining: 40,
        estimatedRemainingSeconds: null,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: {},
      },
    },
  }

  return {
    id: 'session-timeline',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: 'IN_PROGRESS',
    createdAt: '2026-08-05T21:00:00.000Z',
    updatedAt: '2026-08-05T21:10:00.000Z',
    lifecycle,
    jobs: {
      vendors: {
        id: 'job-vendors',
        moduleKey: 'vendors',
        status: 'completed',
        startedAt: '2026-08-05T21:05:00.000Z',
        updatedAt: '2026-08-05T21:09:00.000Z',
        durationMs: 240_000,
        warningCount: 2,
        skipSummary: { 'Duplicate (already exists)': 26 },
        processedRows: 26,
        totalRows: 26,
        importedCount: 0,
        skippedCount: 26,
        activityEvents: lifecycle.vendors.progress?.activityEvents,
        progressSnapshot: lifecycle.vendors.progress?.progressSnapshot,
      },
      products: {
        id: 'job-products',
        moduleKey: 'products',
        status: 'processing',
        startedAt: '2026-08-05T21:10:00.000Z',
        updatedAt: '2026-08-05T21:10:00.000Z',
        processedRows: 0,
        totalRows: 40,
        activityEvents: [],
        progressSnapshot: {},
      },
    },
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state: 'running',
      selectedModules: [
        { key: 'vendors', label: 'Vendors', moduleKey: 'vendors' },
        { key: 'products', label: 'Products & Services', moduleKey: 'products' },
      ],
      duplicateStrategy: 'skip',
      modules: [],
      importJobIds: {
        vendors: 'job-vendors',
        products: 'job-products',
      },
      startedAt: '2026-08-05T21:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('timeline normalizes persisted events into readable migration activity', () => {
  const timeline = buildMigrationActivityTimeline(fixtureSession())

  assert.deepEqual(timeline.map((entry) => entry.message), [
    'Worker claimed Vendors',
    'Fetched 26 records',
    'Duplicate Detection completed',
    'Skipped 26 duplicate records',
    'Module completed',
    'Worker claimed Products & Services',
  ])
  assert.deepEqual(timeline.map((entry) => entry.at.slice(11, 16)), [
    '21:05',
    '21:06',
    '21:07',
    '21:09',
    '21:09',
    '21:10',
  ])
})

test('timeline exposes module, stage, duration, and warning metadata', () => {
  const timeline = buildMigrationActivityTimeline(fixtureSession())
  const duplicateDetection = timeline.find((entry) => entry.id === 'vendors-duplicates')
  const skipped = timeline.find((entry) => entry.type === 'records_skipped')
  const completed = timeline.find((entry) => entry.type === 'module_completed_with_warnings')

  assert.equal(duplicateDetection?.module, 'Vendors')
  assert.equal(duplicateDetection?.stage, 'duplicate_detection')
  assert.equal(duplicateDetection?.durationMs, 1_500)
  assert.equal(skipped?.warningCount, 26)
  assert.equal(skipped?.severity, 'warning')
  assert.equal(completed?.durationMs, 240_000)
  assert.equal(completed?.warningCount, 2)
})

test('live poll deltas append events without duplicating historical activity', () => {
  const initial = fixtureSession()
  const full = projectMigrationPollPayload(initial, { includeStatic: true })
  const restored = mergeMigrationPollPayload(null, full)
  assert.ok(restored)

  const next = fixtureSession()
  next.jobs.products.activityEvents = [{
    id: 'products-fetched',
    at: '2026-08-05T21:11:00.000Z',
    type: 'batch_completed',
    message: 'Completed batch 1',
    module: 'Products & Services',
    stage: 'extraction',
    records: 40,
  }]
  const delta = projectMigrationPollPayload(next, {
    includeStatic: false,
    activityCursors: { vendors: 'vendors-duplicates' },
  })
  const merged = mergeMigrationPollPayload(restored, delta)
  assert.ok(merged)

  const timeline = buildMigrationActivityTimeline(merged)
  assert.equal(timeline.filter((entry) => entry.id === 'vendors-fetched').length, 1)
  assert.equal(timeline.filter((entry) => entry.id === 'products-fetched').length, 1)
  assert.match(timeline.find((entry) => entry.id === 'products-fetched')?.message ?? '', /Fetched 40 records/)
})

test('historical migrations rebuild the same timeline from persisted hydration', () => {
  const historical = fixtureSession()
  historical.config.state = 'completed'
  historical.status = 'COMPLETED'
  historical.step = 'report'
  historical.lifecycle.products.phase = 'completed'
  historical.jobs.products.status = 'completed'
  historical.jobs.products.durationMs = 30_000
  historical.jobs.products.updatedAt = '2026-08-05T21:12:00.000Z'

  const reopened = JSON.parse(JSON.stringify(historical)) as HydratedMigrationSession
  const view = buildMigrationCenterView(reopened, Date.parse('2026-08-05T21:12:00.000Z'))

  assert.ok(view.activityTimeline.some((entry) => entry.message === 'Worker claimed Vendors'))
  assert.ok(view.activityTimeline.some((entry) => entry.message === 'Module completed'))
  assert.ok(view.activityTimeline.some((entry) => entry.message === 'Worker claimed Products & Services'))
  assert.equal(view.activityTimeline[0]?.at, '2026-08-05T21:05:00.000Z')
})

test('Migration Center renders rich timeline metadata from the view model', () => {
  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /data-migration-activity-timeline/)
  assert.match(center, /dateTime=\{event\.at\}/)
  assert.match(center, /event\.module/)
  assert.match(center, /event\.stage/)
  assert.match(center, /event\.durationMs/)
  assert.match(center, /event\.warningCount/)
})
