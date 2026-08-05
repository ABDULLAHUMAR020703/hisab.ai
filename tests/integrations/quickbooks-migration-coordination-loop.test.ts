import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  coordinationFingerprint,
  isReplayableCoordinationAction,
  nextCoordinationAction,
} from '../../src/lib/import-export/wizard/migration-coordination'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type {
  ModuleLifecycleEntry,
  ModuleLifecyclePhase,
  ModuleLifecycleState,
} from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = () => read('src/components/import-export/MigrationSessionProvider.tsx')

function moduleEntry(
  key: string,
  order: number,
  phase: ModuleLifecyclePhase,
  jobId: string | null,
): ModuleLifecycleEntry {
  return {
    key,
    moduleKey: key,
    label: key,
    order,
    phase,
    jobId,
    estimate: { records: 10, batches: 1, durationMs: 1_000 },
    preview: null,
    failure: null,
    unsupported: null,
    progress: null,
    queuePosition: null,
    durationMs: null,
    warningCount: 0,
  }
}

function fixtureSession(overrides?: {
  state?: HydratedMigrationSession['config']['state']
  lifecycle?: ModuleLifecycleState
  jobs?: HydratedMigrationSession['jobs']
}): HydratedMigrationSession {
  const lifecycle: ModuleLifecycleState = overrides?.lifecycle ?? {
    customers: moduleEntry('customers', 0, 'processing', 'job-1'),
    vendors: moduleEntry('vendors', 1, 'queued', null),
  }
  const state = overrides?.state ?? 'running'
  return {
    id: 'session-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: state === 'running' ? 'IN_PROGRESS' : 'COMPLETED',
    createdAt: '2026-08-05T09:59:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    lifecycle,
    jobs: overrides?.jobs ?? {
      customers: { id: 'job-1', moduleKey: 'customers', status: 'processing' },
    },
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state,
      selectedModules: [
        { key: 'customers', label: 'customers', moduleKey: 'customers' },
        { key: 'vendors', label: 'vendors', moduleKey: 'vendors' },
      ],
      duplicateStrategy: 'skip',
      modules: [],
      importJobIds: { customers: 'job-1' },
      startedAt: '2026-08-05T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('a refresh that changes nothing cannot trigger another coordination cycle', () => {
  const first = fixtureSession()
  // Same persisted content, brand-new object graph — exactly what every poll returns.
  const second = JSON.parse(JSON.stringify(first)) as HydratedMigrationSession

  assert.notEqual(first, second)
  assert.equal(coordinationFingerprint(first), coordinationFingerprint(second))
  assert.equal(coordinationFingerprint(null), '')
})

test('coordination signal changes only on real lifecycle transitions', () => {
  const base = fixtureSession()
  const baseSignal = coordinationFingerprint(base)

  const moduleCompleted = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', null),
    },
  })
  const moduleFailed = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'failed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', null),
    },
  })
  const jobCreated = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'processing', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', 'job-2'),
    },
  })
  const jobStatusChanged = fixtureSession({
    jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'completed' } },
  })
  const newSession = { ...fixtureSession(), id: 'session-2' }
  const terminal = fixtureSession({ state: 'completed' })

  for (const [label, session] of [
    ['module completed', moduleCompleted],
    ['module failed', moduleFailed],
    ['job created', jobCreated],
    ['job status changed', jobStatusChanged],
    ['new session', newSession],
    ['session state changed', terminal],
  ] as const) {
    assert.notEqual(coordinationFingerprint(session), baseSignal, `${label} must re-arm coordination`)
  }

  // Progress counters churn on every poll and must not re-arm coordination.
  const progressed = fixtureSession()
  progressed.lifecycle.customers.progress = {
    processedRows: 7,
    totalRows: 10,
    importedCount: 7,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    progressPercent: 70,
    currentStage: 'persist',
    currentRecord: 'CUST-7',
    currentBatch: 1,
    totalBatches: 1,
    elapsedMs: 3_000,
    throughput: 2,
    averageThroughput: 2,
    estimatedRemaining: 1,
    estimatedRemainingSeconds: 1,
    estimatedCompletionAt: null,
    activityEvents: [],
    progressSnapshot: {},
  }
  progressed.updatedAt = '2026-08-05T10:00:09.000Z'
  assert.equal(coordinationFingerprint(progressed), baseSignal)
})

test('a queue run is dispatched once and never repeated for the same job', () => {
  const session = fixtureSession({
    lifecycle: { customers: moduleEntry('customers', 0, 'queued', 'job-1') },
    jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'pending' } },
  })
  const issued = new Set<string>()

  const first = nextCoordinationAction(session, issued)
  assert.equal(first.type, 'run-job')
  assert.ok(first.key)
  issued.add(first.key!)

  // Same persisted state re-evaluated after any number of polls.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    assert.equal(nextCoordinationAction(session, issued).type, 'idle')
  }

  // The worker picking the job up also stops any further run dispatch.
  const running = fixtureSession({
    lifecycle: { customers: moduleEntry('customers', 0, 'processing', 'job-1') },
    jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'processing' } },
  })
  assert.equal(nextCoordinationAction(running, new Set()).type, 'idle')
})

test('an import is created once per module even when stale payloads arrive', () => {
  const session = fixtureSession({
    lifecycle: { vendors: moduleEntry('vendors', 0, 'queued', null) },
    jobs: {},
  })
  const issued = new Set<string>()

  const create = nextCoordinationAction(session, issued)
  assert.equal(create.type, 'create-job')
  assert.equal(create.type === 'create-job' && create.module.key, 'vendors')
  issued.add(create.key!)

  // A stale response that still lacks the job id must not create a second import.
  assert.equal(nextCoordinationAction(session, issued).type, 'idle')
  assert.equal(nextCoordinationAction(JSON.parse(JSON.stringify(session)), issued).type, 'idle')
  // A created import is never replayed, even after a failed follow-up request.
  assert.equal(isReplayableCoordinationAction(create), false)
  assert.equal(isReplayableCoordinationAction({ type: 'run-job', key: 'k', module: moduleEntry('vendors', 0, 'queued', 'job-9') }), true)
})

test('coordination advances one step per lifecycle transition and then goes idle', () => {
  const issued = new Set<string>()
  const queued = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', null),
    },
    jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'completed' } },
  })

  const create = nextCoordinationAction(queued, issued)
  assert.equal(create.type, 'create-job')
  issued.add(create.key!)

  const withJob = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', 'job-2'),
    },
    jobs: {
      customers: { id: 'job-1', moduleKey: 'customers', status: 'completed' },
      vendors: { id: 'job-2', moduleKey: 'vendors', status: 'pending' },
    },
  })
  const run = nextCoordinationAction(withJob, issued)
  assert.equal(run.type, 'run-job')
  issued.add(run.key!)
  assert.equal(nextCoordinationAction(withJob, issued).type, 'idle')

  const allDone = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'completed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'completed_with_warnings', 'job-2'),
    },
    jobs: {
      customers: { id: 'job-1', moduleKey: 'customers', status: 'completed' },
      vendors: { id: 'job-2', moduleKey: 'vendors', status: 'completed' },
    },
  })
  const complete = nextCoordinationAction(allDone, issued)
  assert.equal(complete.type, 'mark-completed')
  issued.add(complete.key!)
  assert.equal(nextCoordinationAction(allDone, issued).type, 'idle')

  const broken = fixtureSession({
    lifecycle: {
      customers: moduleEntry('customers', 0, 'failed', 'job-1'),
      vendors: moduleEntry('vendors', 1, 'queued', null),
    },
    jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'failed' } },
  })
  const failed = nextCoordinationAction(broken, new Set())
  assert.equal(failed.type, 'mark-failed')

  // Terminal sessions and unsupported modules never coordinate.
  assert.equal(nextCoordinationAction(fixtureSession({ state: 'completed' }), new Set()).type, 'idle')
  assert.equal(nextCoordinationAction(fixtureSession({ state: 'cancelled' }), new Set()).type, 'idle')
  assert.equal(
    nextCoordinationAction(fixtureSession({
      lifecycle: {
        customers: moduleEntry('customers', 0, 'completed', 'job-1'),
        vendors: moduleEntry('vendors', 1, 'unsupported', null),
        bills: moduleEntry('bills', 2, 'preview_failed', null),
      },
      jobs: { customers: { id: 'job-1', moduleKey: 'customers', status: 'completed' } },
    }), new Set()).type,
    'mark-completed',
  )
})

test('provider coordination is event-driven, not session-identity driven', () => {
  const source = provider()

  assert.match(source, /coordinationFingerprint\(session\)/)
  assert.match(source, /void coordinate\(coordinationSignal\)/)
  assert.match(source, /\[coordinate, coordinationAttempt, coordinationSignal\]/)
  // The old loop: session change -> coordinate -> refresh -> setSession -> coordinate.
  assert.doesNotMatch(source, /\.then\(refresh\)/)
  assert.doesNotMatch(source, /\}, \[coordinate, refresh, session\]\)/)

  const coordinationEffect = source.slice(
    source.indexOf('void coordinate(coordinationSignal)'),
    source.indexOf('const retry = useCallback'),
  )
  assert.doesNotMatch(coordinationEffect, /refresh/)
})

test('provider runs a single coordination cycle and discards stale refreshes', () => {
  const source = provider()

  assert.match(source, /if \(coordinatingRef\.current\) \{/)
  assert.match(source, /pendingSignalRef\.current = signal/)
  assert.match(source, /if \(coordinatedSignalRef\.current === signal\) return/)
  assert.match(source, /coordinatingRef\.current = false/)

  assert.match(source, /refreshControllerRef\.current\?\.abort\(\)/)
  assert.match(source, /new AbortController\(\)/)
  assert.match(source, /signal: controller\.signal/)
  assert.match(source, /const sequence = \+\+refreshSequenceRef\.current/)
  assert.match(source, /sequence !== refreshSequenceRef\.current/)
  assert.match(source, /if \(controller\.signal\.aborted\) return/)

  // Coordination re-arms on explicit events only: start, retry, resume, cancel.
  assert.match(source, /const forceCoordinationCycle = useCallback/)
  assert.match(source, /issuedActionsRef\.current\.clear\(\)/)
  assert.match(source, /window\.addEventListener\('quickbooks-migration-session-changed', handleSessionChanged\)/)
  assert.match(source, /forceCoordinationCycle\(\)[\s\S]{0,40}void refresh\(\)/)

  // Polling itself stays a single interval that never bumps coordination on success.
  assert.match(source, /POLL_INTERVAL_MS = 1_500/)
  assert.match(source, /if \(coordinationFailedRef\.current\) setCoordinationAttempt/)
  assert.equal(source.match(/window\.setInterval/g)?.length, 1)
})

test('callbacks exposed to routes keep a stable identity across polls', () => {
  const source = provider()

  // openViewer/openMigrationCenter must not re-arm route effects on every refresh.
  // Every dependency below is itself poll-independent, so these callbacks never churn.
  assert.match(source, /const navigateOnce = useCallback\(\(target: string\) => \{[\s\S]*?\}, \[releaseNavigationLatch, router, syncNavigationLatch\]\)/)
  assert.match(source, /const openMigrationCenter = useCallback\(\(sessionId\?: string\) => \{[\s\S]*?\}, \[navigateOnce\]\)/)
  assert.match(source, /const openViewer = useCallback\(\(\) => \{[\s\S]*?\}, \[openMigrationCenter, syncNavigationLatch\]\)/)
  assert.match(source, /sessionRef\.current/)

  const wizardPage = read('src/app/(dashboard)/migration-wizard/page.tsx')
  assert.match(wizardPage, /\}, \[openViewer, sessionLoading\]\)/)
})
