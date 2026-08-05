import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import {
  deriveCompletedThroughput,
  deriveMigrationTiming,
  ETA_ESTIMATING_LABEL,
} from '../../src/lib/import-export/wizard/migration-timing'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type { ModuleLifecycleEntry, ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'
import { MigrationTrace } from '../../src/lib/import-export/quickbooks/migration-telemetry'

const read = (path: string) => readFileSync(path, 'utf8')
const NOW = Date.parse('2026-08-05T14:00:00.000Z')

function entry(partial: Partial<ModuleLifecycleEntry> & Pick<ModuleLifecycleEntry, 'key' | 'label' | 'phase'>): ModuleLifecycleEntry {
  return {
    moduleKey: partial.moduleKey ?? partial.key,
    order: partial.order ?? 0,
    jobId: partial.jobId ?? null,
    estimate: partial.estimate ?? null,
    preview: null,
    failure: null,
    unsupported: null,
    progress: partial.progress ?? null,
    queuePosition: partial.queuePosition ?? null,
    durationMs: partial.durationMs ?? null,
    warningCount: partial.warningCount ?? 0,
    ...partial,
  }
}

function sessionFrom(lifecycle: ModuleLifecycleState, state: HydratedMigrationSession['config']['state'] = 'running'): HydratedMigrationSession {
  return {
    id: 'session-timing',
    companyId: 'company-1',
    userId: 'user-1',
    step: state === 'completed' ? 'report' : 'import',
    status: state === 'running' ? 'IN_PROGRESS' : state === 'cancelled' ? 'CANCELLED' : 'COMPLETED',
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
    jobs: {},
    lifecycle,
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state,
      selectedModules: Object.values(lifecycle).map((module) => ({
        key: module.key,
        label: module.label,
        moduleKey: module.moduleKey,
      })),
      duplicateStrategy: 'skip',
      modules: [],
      importJobIds: Object.fromEntries(
        Object.values(lifecycle)
          .filter((module) => module.jobId)
          .map((module) => [module.key, module.jobId as string]),
      ),
      startedAt: '2026-08-05T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('queued migrations measure elapsed wall time but no active processing or ETA', () => {
  const lifecycle: ModuleLifecycleState = {
    accounts: entry({
      key: 'accounts',
      label: 'Accounts',
      order: 0,
      phase: 'queued',
      estimate: { records: 100, batches: 1, durationMs: 3_000 },
    }),
    customers: entry({
      key: 'customers',
      label: 'Customers',
      order: 1,
      phase: 'queued',
      estimate: { records: 50, batches: 1, durationMs: 2_000 },
      queuePosition: 1,
    }),
  }

  const timing = deriveMigrationTiming(sessionFrom(lifecycle), NOW)
  assert.equal(timing.elapsedMs, 4 * 60 * 60 * 1000)
  assert.equal(timing.activeProcessingMs, 0)
  assert.equal(timing.completedThroughput, null)
  assert.equal(timing.remainingMs, null)
  assert.equal(timing.etaLabel, ETA_ESTIMATING_LABEL)
})

test('processing without completed history shows Estimating... instead of preview ETAs', () => {
  const lifecycle: ModuleLifecycleState = {
    invoices: entry({
      key: 'invoices',
      label: 'Invoices',
      order: 0,
      phase: 'processing',
      jobId: 'job-1',
      estimate: { records: 1_000, batches: 10, durationMs: 30_000 },
      progress: {
        processedRows: 20,
        totalRows: 1_000,
        importedCount: 20,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 2,
        currentStage: 'materialization',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 10,
        elapsedMs: 4 * 60 * 60 * 1000,
        throughput: 50,
        averageThroughput: 50,
        estimatedRemaining: 980,
        estimatedRemainingSeconds: 33,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: {
          startedAt: '2026-08-05T13:59:30.000Z',
          activeProcessingMs: 30_000,
          averageThroughput: 50,
        },
      },
    }),
  }

  const view = buildMigrationCenterView(sessionFrom(lifecycle), NOW)
  assert.equal(view.elapsedMs, 4 * 60 * 60 * 1000)
  assert.equal(view.activeProcessingMs, 30_000)
  assert.equal(view.etaLabel, ETA_ESTIMATING_LABEL)
  assert.equal(view.remainingMs, null)
  assert.ok(view.elapsedMs > (view.remainingMs ?? 0))
})

test('paused migrations freeze active processing time and withhold ETA', () => {
  const lifecycle: ModuleLifecycleState = {
    customers: entry({
      key: 'customers',
      label: 'Customers',
      order: 0,
      phase: 'paused',
      jobId: 'job-1',
      progress: {
        processedRows: 40,
        totalRows: 200,
        importedCount: 40,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 20,
        currentStage: 'materialization',
        currentRecord: null,
        currentBatch: 2,
        totalBatches: 5,
        elapsedMs: 90_000,
        throughput: 1,
        averageThroughput: 1,
        estimatedRemaining: 160,
        estimatedRemainingSeconds: 160,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: {
          startedAt: '2026-08-05T11:00:00.000Z',
          activeProcessingMs: 45_000,
        },
      },
    }),
  }

  const timing = deriveMigrationTiming(sessionFrom(lifecycle), NOW)
  assert.equal(timing.elapsedMs, 4 * 60 * 60 * 1000)
  assert.equal(timing.activeProcessingMs, 45_000)
  assert.equal(timing.etaLabel, ETA_ESTIMATING_LABEL)
})

test('resumed migrations accumulate prior activeProcessingMs across continuation steps', () => {
  const trace = new MigrationTrace('customers', undefined, { initialActiveProcessingMs: 12_000 })
  trace.setTotals(25, 100)
  const snapshot = trace.snapshot()
  assert.ok(snapshot.activeProcessingMs >= 12_000)
  assert.ok(snapshot.averageThroughput > 0)
  assert.ok(snapshot.averageThroughput < 25 / (12_000 / 1000))

  const importRoute = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(importRoute, /initialActiveProcessingMs: Number\(job\.progressSnapshot\?\.activeProcessingMs/)
})

test('cancelled migrations keep wall-clock elapsed and completed active time only', () => {
  const lifecycle: ModuleLifecycleState = {
    accounts: entry({
      key: 'accounts',
      label: 'Accounts',
      order: 0,
      phase: 'completed',
      jobId: 'job-1',
      durationMs: 60_000,
      progress: {
        processedRows: 90,
        totalRows: 90,
        importedCount: 90,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 100,
        currentStage: null,
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 60_000,
        throughput: 1.5,
        averageThroughput: 1.5,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: { activeProcessingMs: 60_000 },
      },
    }),
    invoices: entry({
      key: 'invoices',
      label: 'Invoices',
      order: 1,
      phase: 'cancelled',
      jobId: 'job-2',
      progress: {
        processedRows: 10,
        totalRows: 200,
        importedCount: 10,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 5,
        currentStage: 'materialization',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 2,
        elapsedMs: 20_000,
        throughput: 0.5,
        averageThroughput: 0.5,
        estimatedRemaining: 190,
        estimatedRemainingSeconds: 380,
        estimatedCompletionAt: null,
        activityEvents: [{ id: 'e1', at: '2026-08-05T11:00:00.000Z', type: 'info', message: 'batch' }],
        progressSnapshot: { activeProcessingMs: 20_000 },
      },
    }),
    vendors: entry({
      key: 'vendors',
      label: 'Vendors',
      order: 2,
      phase: 'cancelled',
      estimate: { records: 40, batches: 1, durationMs: 8_000 },
    }),
  }

  const timing = deriveMigrationTiming(sessionFrom(lifecycle, 'cancelled'), NOW)
  assert.equal(timing.elapsedMs, 2 * 60 * 60 * 1000)
  assert.equal(timing.activeProcessingMs, 80_000)
  assert.equal(timing.remainingMs, 0)
  assert.equal(timing.etaLabel, '0m 00s')
})

test('completed throughput drives ETA and ignores queued preview estimates', () => {
  const lifecycle: ModuleLifecycleState = {
    accounts: entry({
      key: 'accounts',
      label: 'Accounts',
      order: 0,
      phase: 'completed',
      jobId: 'job-1',
      durationMs: 10_000,
      progress: {
        processedRows: 100,
        totalRows: 100,
        importedCount: 100,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 100,
        currentStage: null,
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 10_000,
        throughput: 10,
        averageThroughput: 10,
        estimatedRemaining: 0,
        estimatedRemainingSeconds: 0,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: { activeProcessingMs: 10_000 },
      },
    }),
    invoices: entry({
      key: 'invoices',
      label: 'Invoices',
      order: 1,
      phase: 'processing',
      jobId: 'job-2',
      estimate: { records: 50, batches: 1, durationMs: 999_000 },
      progress: {
        processedRows: 20,
        totalRows: 50,
        importedCount: 20,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        progressPercent: 40,
        currentStage: 'materialization',
        currentRecord: null,
        currentBatch: 1,
        totalBatches: 1,
        elapsedMs: 5_000,
        throughput: 100,
        averageThroughput: 100,
        estimatedRemaining: 30,
        estimatedRemainingSeconds: 0.3,
        estimatedCompletionAt: null,
        activityEvents: [],
        progressSnapshot: {
          startedAt: '2026-08-05T13:59:50.000Z',
          activeProcessingMs: 5_000,
          averageThroughput: 100,
        },
      },
    }),
    vendors: entry({
      key: 'vendors',
      label: 'Vendors',
      order: 2,
      phase: 'queued',
      estimate: { records: 70, batches: 1, durationMs: 1_000 },
      queuePosition: 1,
    }),
  }

  const timing = deriveMigrationTiming(sessionFrom(lifecycle), NOW)
  assert.equal(deriveCompletedThroughput(Object.values(lifecycle)), 10)
  assert.equal(timing.completedThroughput, 10)
  // remaining = (50-20) + 70 = 100 records at 10 r/s => 10s
  assert.equal(timing.remainingMs, 10_000)
  assert.equal(timing.etaLabel, '0m 10s')
  assert.ok(timing.elapsedMs > timing.remainingMs!)
})

test('Migration Center renders both elapsed and active processing metrics', () => {
  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /Elapsed Time/)
  assert.match(center, /Active Processing Time/)
  assert.match(center, /view\.activeProcessingMs/)
  assert.match(center, /ETA/)
  assert.doesNotMatch(center, /Calculating…/)
})
