import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  detectMigrationQueueHealth,
  type PersistedQueueJobSnapshot,
  type QueueImportJobSnapshot,
} from '../../src/lib/import-export/wizard/migration-queue-health'

const NOW = Date.parse('2026-08-05T10:00:00.000Z')
const THRESHOLDS = {
  queueStallThresholdMs: 2 * 60_000,
  heartbeatTimeoutMs: 90_000,
}

function importJob(overrides: Partial<QueueImportJobSnapshot> = {}): QueueImportJobSnapshot {
  return {
    status: 'pending',
    createdAt: '2026-08-05T09:59:00.000Z',
    updatedAt: '2026-08-05T09:59:00.000Z',
    startedAt: null,
    pausedAt: null,
    lastHeartbeatAt: '2026-08-05T09:59:00.000Z',
    processedRows: 0,
    ...overrides,
  }
}

function queueJob(overrides: Partial<PersistedQueueJobSnapshot> = {}): PersistedQueueJobSnapshot {
  return {
    id: 'queue-1',
    importJobId: 'import-1',
    status: 'PENDING',
    scheduledAt: '2026-08-05T09:59:00.000Z',
    startedAt: null,
    completedAt: null,
    createdAt: '2026-08-05T09:59:00.000Z',
    updatedAt: '2026-08-05T09:59:00.000Z',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    ...overrides,
  }
}

test('healthy queue remains Queued without a worker warning', () => {
  const health = detectMigrationQueueHealth({
    importJob: importJob(),
    queueJob: queueJob(),
    now: NOW,
    thresholds: THRESHOLDS,
  })

  assert.equal(health.state, 'queued')
  assert.equal(health.label, 'Queued')
  assert.equal(health.warning, null)
  assert.equal(health.waitingMs, 60_000)
  assert.equal(health.lastQueueUpdateAt, '2026-08-05T09:59:00.000Z')
  assert.equal(health.retryAppropriate, false)
})

test('stalled queue reports Worker Not Running after the configured threshold', () => {
  const health = detectMigrationQueueHealth({
    importJob: importJob({
      createdAt: '2026-08-05T09:55:00.000Z',
      updatedAt: '2026-08-05T09:55:00.000Z',
      lastHeartbeatAt: null,
    }),
    queueJob: queueJob({
      scheduledAt: '2026-08-05T09:55:00.000Z',
      createdAt: '2026-08-05T09:55:00.000Z',
      updatedAt: '2026-08-05T09:55:00.000Z',
    }),
    now: NOW,
    thresholds: THRESHOLDS,
  })

  assert.equal(health.state, 'queued')
  assert.equal(health.warning, 'not_running')
  assert.equal(health.warningMessage, 'No background worker has claimed this migration.')
  assert.equal(health.waitingMs, 5 * 60_000)
  assert.match(health.suggestedAction ?? '', /Start or verify the background worker/)
  assert.equal(health.retryAppropriate, false)
})

test('lost worker heartbeat reports the worker offline without retrying', () => {
  const health = detectMigrationQueueHealth({
    importJob: importJob({
      status: 'processing',
      updatedAt: '2026-08-05T09:55:00.000Z',
      lastHeartbeatAt: '2026-08-05T09:55:00.000Z',
      processedRows: 40,
    }),
    queueJob: queueJob({
      status: 'RUNNING',
      startedAt: '2026-08-05T09:54:30.000Z',
      updatedAt: '2026-08-05T09:55:00.000Z',
      attempts: 1,
    }),
    now: NOW,
    thresholds: THRESHOLDS,
  })

  assert.equal(health.state, 'processing')
  assert.equal(health.warning, 'offline')
  assert.equal(health.warningMessage, 'Background worker appears offline.')
  assert.equal(health.lastHeartbeatAt, '2026-08-05T09:55:00.000Z')
  assert.equal(health.waitingMs, 5 * 60_000)
  assert.equal(health.retryAppropriate, false)
})

test('worker recovery clears the offline warning when persisted heartbeat resumes', () => {
  const health = detectMigrationQueueHealth({
    importJob: importJob({
      status: 'processing',
      updatedAt: '2026-08-05T09:59:45.000Z',
      lastHeartbeatAt: '2026-08-05T09:59:45.000Z',
      processedRows: 50,
    }),
    queueJob: queueJob({
      status: 'RUNNING',
      startedAt: '2026-08-05T09:54:30.000Z',
      updatedAt: '2026-08-05T09:59:45.000Z',
      attempts: 2,
      lastError: 'Recovered abandoned RUNNING job after heartbeat timeout.',
    }),
    now: NOW,
    thresholds: THRESHOLDS,
  })

  assert.equal(health.state, 'processing')
  assert.equal(health.label, 'Processing')
  assert.equal(health.warning, null)
  assert.equal(health.lastHeartbeatAt, '2026-08-05T09:59:45.000Z')
})

test('a queued job eventually claimed by a worker becomes Worker Claimed', () => {
  const pending = detectMigrationQueueHealth({
    importJob: importJob(),
    queueJob: queueJob(),
    now: NOW,
    thresholds: THRESHOLDS,
  })
  const claimed = detectMigrationQueueHealth({
    importJob: importJob({ updatedAt: '2026-08-05T10:00:05.000Z' }),
    queueJob: queueJob({
      status: 'RUNNING',
      startedAt: '2026-08-05T10:00:05.000Z',
      updatedAt: '2026-08-05T10:00:05.000Z',
      attempts: 1,
    }),
    now: Date.parse('2026-08-05T10:00:06.000Z'),
    thresholds: THRESHOLDS,
  })

  assert.equal(pending.state, 'queued')
  assert.equal(claimed.state, 'worker_claimed')
  assert.equal(claimed.label, 'Worker Claimed')
  assert.equal(claimed.workerClaimedAt, '2026-08-05T10:00:05.000Z')
  assert.equal(claimed.warning, null)
})

test('paused, completed, and failed import jobs expose explicit persisted states', () => {
  const paused = detectMigrationQueueHealth({
    importJob: importJob({ status: 'paused' }),
    queueJob: queueJob({ status: 'RUNNING' }),
    now: NOW,
    thresholds: THRESHOLDS,
  })
  const completed = detectMigrationQueueHealth({
    importJob: importJob({ status: 'completed' }),
    queueJob: queueJob({ status: 'COMPLETED' }),
    now: NOW,
    thresholds: THRESHOLDS,
  })
  const failed = detectMigrationQueueHealth({
    importJob: importJob({ status: 'failed' }),
    queueJob: queueJob({ status: 'FAILED', lastError: 'Worker failed' }),
    now: NOW,
    thresholds: THRESHOLDS,
  })

  assert.equal(paused.label, 'Paused')
  assert.equal(completed.label, 'Completed')
  assert.equal(failed.label, 'Failed')
  assert.equal(failed.retryAppropriate, true)
})

test('session hydration reads queue ownership evidence without changing the worker', () => {
  const service = readFileSync('src/lib/import-export/wizard/migration-session.service.ts', 'utf8')
  const queue = readFileSync('src/lib/platform/jobs/queue.ts', 'utf8')

  assert.match(service, /\.from\('job_queue'\)/)
  assert.match(service, /\.eq\('job_type', 'QUICKBOOKS_IMPORT_STEP'\)/)
  assert.match(service, /\.in\('payload->>importJobId', importJobIds\)/)
  assert.match(service, /detectMigrationQueueHealth/)
  assert.match(service, /MIGRATION_QUEUE_STALL_MS/)
  assert.match(service, /MIGRATION_WORKER_HEARTBEAT_TIMEOUT_MS/)
  assert.doesNotMatch(service, /claimNextJob|heartbeatJob|enqueueJob/)

  assert.match(queue, /claimNextJob/)
  assert.match(queue, /heartbeatJob/)
})

test('Migration Center renders warning evidence and never automatically retries', () => {
  const center = readFileSync('src/components/import-export/MigrationCenter.tsx', 'utf8')
  const provider = readFileSync('src/components/import-export/MigrationSessionProvider.tsx', 'utf8')

  assert.match(center, /Worker Not Running/)
  assert.match(center, /Time waiting/)
  assert.match(center, /Last queue update/)
  assert.match(center, /Suggested action:/)
  assert.match(center, /view\.executionHealth\.retryAppropriate && onRetry/)
  assert.match(center, /data-worker-status=\{view\.workerStatus\}/)
  assert.match(provider, /workerWarning\?\.warningMessage/)

  const warningBlock = center.slice(
    center.indexOf('view.executionHealth?.warning &&'),
    center.indexOf('<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"'),
  )
  assert.doesNotMatch(warningBlock, /useEffect|setInterval|onRetry\(\)/)
})
