import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  collectMigrationSessionActivity,
  DEFAULT_MIGRATION_SESSION_STALE_MS,
  resolveMigrationSessionReconciliation,
} from '../../src/lib/import-export/wizard/migration-session-reconcile'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type {
  ModuleLifecycleEntry,
  ModuleLifecyclePhase,
  ModuleLifecycleState,
} from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

const NOW = Date.parse('2026-08-06T12:00:00.000Z')
const RECENT = new Date(NOW - 30_000).toISOString()
const LONG_AGO = new Date(NOW - DEFAULT_MIGRATION_SESSION_STALE_MS - 60_000).toISOString()

function moduleEntry(key: string, order: number, phase: ModuleLifecyclePhase, jobId: string | null): ModuleLifecycleEntry {
  return {
    key,
    moduleKey: key,
    label: key,
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

function jobSnapshot(id: string, moduleKey: string, status: string, updatedAt: string) {
  return { id, moduleKey, status, updatedAt } as unknown as HydratedMigrationSession['jobs'][string]
}

function queueSnapshot(id: string, importJobId: string, status: 'PENDING' | 'RUNNING') {
  return {
    id,
    importJobId,
    status,
    scheduledAt: RECENT,
    startedAt: status === 'RUNNING' ? RECENT : null,
    completedAt: null,
    createdAt: RECENT,
    updatedAt: RECENT,
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
  }
}

function fixtureSession(overrides?: {
  state?: HydratedMigrationSession['config']['state']
  lifecycle?: ModuleLifecycleState
  jobs?: HydratedMigrationSession['jobs']
  queueJobs?: HydratedMigrationSession['queueJobs']
  updatedAt?: string
}): HydratedMigrationSession {
  const state = overrides?.state ?? 'running'
  return {
    id: 'session-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: state === 'running' ? 'IN_PROGRESS' : 'COMPLETED',
    createdAt: '2026-08-06T10:00:00.000Z',
    updatedAt: overrides?.updatedAt ?? RECENT,
    lifecycle: overrides?.lifecycle ?? {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
    },
    jobs: overrides?.jobs ?? { customers: jobSnapshot('job-1', 'customers', 'completed', RECENT) },
    queueJobs: overrides?.queueJobs ?? {},
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state,
      selectedModules: [{ key: 'customers', label: 'customers', moduleKey: 'customers' }],
      duplicateStrategy: 'skip',
      modules: [],
      importJobIds: { customers: 'job-1' },
      startedAt: '2026-08-06T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

const resolve = (session: HydratedMigrationSession, options: { ignoreQueueJobIds?: string[] } = {}) =>
  resolveMigrationSessionReconciliation(
    session,
    collectMigrationSessionActivity(session, options),
    { now: NOW },
  )

test('a session whose modules all completed is closed without any browser', () => {
  const resolution = resolve(fixtureSession())
  assert.deepEqual(resolution, { state: 'completed', reason: 'all_modules_completed', step: 'report' })
})

test('a session whose modules all reached a terminal state with a failure is closed as failed', () => {
  const session = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'failed', 'job-2'),
    },
    jobs: {
      customers: jobSnapshot('job-1', 'customers', 'completed', RECENT),
      vendors: jobSnapshot('job-2', 'vendors', 'failed', RECENT),
    },
  })
  assert.deepEqual(resolve(session), { state: 'failed', reason: 'module_terminal_failure', step: 'import' })
})

test('unsupported and preview-failed modules never keep a session open', () => {
  const session = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      budgets: moduleEntry('budgets', 1, 'unsupported', null),
      classes: moduleEntry('classes', 2, 'preview_failed', null),
    },
  })
  assert.equal(resolve(session)?.state, 'completed')
})

test('a running worker or queued continuation keeps the session open', () => {
  const processing = fixtureSession({
    lifecycle: { customers: moduleEntry('customers', 0, 'processing', 'job-1') },
    jobs: { customers: jobSnapshot('job-1', 'customers', 'processing', RECENT) },
  })
  assert.equal(resolve(processing), null)

  const queued = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', 'job-2'),
    },
    jobs: {
      customers: jobSnapshot('job-1', 'customers', 'completed', RECENT),
      vendors: jobSnapshot('job-2', 'vendors', 'pending', RECENT),
    },
    queueJobs: { vendors: queueSnapshot('queue-2', 'job-2', 'PENDING') },
  })
  assert.equal(resolve(queued), null)
})

test('a paused module is user state and is never auto-closed', () => {
  const session = fixtureSession({
    lifecycle: { customers: moduleEntry('customers', 0, 'paused', 'job-1') },
    jobs: { customers: jobSnapshot('job-1', 'customers', 'paused', LONG_AGO) },
    updatedAt: LONG_AGO,
  })
  assert.equal(resolve(session), null)
})

test('an abandoned chain is closed only after the stale window elapses', () => {
  // The production shape: finished modules, then modules that never got a job
  // because the browser driving coordination went away.
  const build = (updatedAt: string) => fixtureSession({
    updatedAt,
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      invoices: moduleEntry('invoices', 1, 'ready', null),
    },
    jobs: { customers: jobSnapshot('job-1', 'customers', 'completed', updatedAt) },
  })

  assert.equal(resolve(build(RECENT)), null)
  assert.deepEqual(resolve(build(LONG_AGO)), { state: 'failed', reason: 'abandoned', step: 'import' })
})

test('the step that is reconciling is excluded so its own RUNNING row cannot block closure', () => {
  const session = fixtureSession({
    queueJobs: { customers: queueSnapshot('queue-1', 'job-1', 'RUNNING') },
  })

  assert.equal(resolve(session), null)
  assert.equal(resolve(session, { ignoreQueueJobIds: ['queue-1'] })?.state, 'completed')
})

test('sessions that already reached a terminal state are left alone', () => {
  for (const state of ['completed', 'failed', 'cancelled'] as const) {
    assert.equal(resolve(fixtureSession({ state })), null)
  }
})

test('the latest import job write counts as activity, not just the session row', () => {
  const activity = collectMigrationSessionActivity(fixtureSession({
    updatedAt: LONG_AGO,
    jobs: { customers: jobSnapshot('job-1', 'customers', 'completed', RECENT) },
  }))
  assert.equal(activity.lastActivityAt, RECENT)
})

test('server paths reconcile sessions so completion no longer depends on an open tab', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /export async function reconcileQuickBooksMigrationSession/)
  assert.match(service, /export async function reconcileMigrationSessionForImportJob/)
  // Poll and active-session lookup both heal a stale row.
  assert.match(service, /const session = await reconcileQuickBooksMigrationSession\(found\)/)
  assert.match(service, /isActiveMigrationSession\(hydrated\) \? hydrated : null/)

  const workers = read('src/lib/platform/jobs/workers.ts')
  assert.match(workers, /reconcileMigrationSessionForImportJob\(importJobId, companyId, \{ ignoreQueueJobIds: \[platformJobId\] \}\)/)
})
