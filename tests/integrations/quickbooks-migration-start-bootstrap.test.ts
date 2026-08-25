import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { planMigrationStartBootstrap } from '../../src/lib/import-export/wizard/migration-session-bootstrap'
import { orderQuickBooksMigrationResources, quickBooksResourceDependenciesCompleted } from '../../src/lib/import-export/quickbooks/dependency-order'
import { isWorkerOwnedQuickBooksMigration } from '../../src/lib/import-export/wizard/migration-session'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type {
  ModuleLifecycleEntry,
  ModuleLifecyclePhase,
  ModuleLifecycleState,
} from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

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
    estimate: { records: 3, batches: 1, durationMs: 1_000 },
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
    'journal-entries': moduleEntry('journal-entries', 0, 'ready', null),
  }
  const state = overrides?.state ?? 'running'
  return {
    id: 'session-start-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: state === 'running' ? 'IN_PROGRESS' : 'COMPLETED',
    createdAt: '2026-08-06T15:43:25.648Z',
    updatedAt: '2026-08-06T15:43:25.648Z',
    lifecycle,
    jobs: overrides?.jobs ?? {},
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state,
      selectedModules: Object.values(lifecycle).map((entry) => ({
        key: entry.key,
        label: entry.label,
        moduleKey: entry.moduleKey,
      })),
      duplicateStrategy: 'update',
      modules: [],
      importJobIds: Object.fromEntries(
        Object.values(lifecycle)
          .filter((entry) => entry.jobId)
          .map((entry) => [entry.key, entry.jobId!]),
      ),
      startedAt: '2026-08-06T15:43:25.531Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox Co',
      currency: 'USD',
    },
  }
}

test('start bootstrap plans create-and-enqueue when the first module has no import job', () => {
  const plan = planMigrationStartBootstrap(fixtureSession())
  assert.equal(plan.type, 'create-and-enqueue')
  assert.equal(plan.type === 'create-and-enqueue' && plan.module.key, 'journal-entries')
})

test('start bootstrap plans enqueue-only when the import job exists but is still pending', () => {
  const plan = planMigrationStartBootstrap(fixtureSession({
    lifecycle: { 'journal-entries': moduleEntry('journal-entries', 0, 'queued', 'job-1') },
    jobs: { 'journal-entries': { id: 'job-1', moduleKey: 'journal-entries', status: 'pending' } },
  }))
  assert.equal(plan.type, 'enqueue-only')
  assert.equal(plan.type === 'enqueue-only' && plan.module.jobId, 'job-1')
})

test('start bootstrap is a no-op once the worker owns the first module', () => {
  assert.equal(planMigrationStartBootstrap(fixtureSession({
    lifecycle: { 'journal-entries': moduleEntry('journal-entries', 0, 'processing', 'job-1') },
    jobs: { 'journal-entries': { id: 'job-1', moduleKey: 'journal-entries', status: 'processing' } },
  })).type, 'none')

  assert.equal(planMigrationStartBootstrap(fixtureSession({
    state: 'completed',
    lifecycle: { 'journal-entries': moduleEntry('journal-entries', 0, 'completed', 'job-1') },
    jobs: { 'journal-entries': { id: 'job-1', moduleKey: 'journal-entries', status: 'completed' } },
  })).type, 'none')
})

test('session create bootstraps the first import job and queue row on the server', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /return bootstrapQuickBooksMigrationQueue\(/)
  assert.match(service, /export async function bootstrapQuickBooksMigrationQueue/)
  assert.match(service, /createImportJob\(/)
  assert.match(service, /setImportJobStatus\(created\.id, 'pending'\)/)
  assert.match(service, /enqueueJob\(\{/)
  assert.match(service, /jobType: 'QUICKBOOKS_IMPORT_STEP'/)

  // Create path must not leave queue insertion to a later browser coordinate cycle.
  const createFn = service.slice(
    service.indexOf('export async function createQuickBooksMigrationSession'),
    service.indexOf('export async function bootstrapQuickBooksMigrationQueue'),
  )
  assert.match(createFn, /bootstrapQuickBooksMigrationQueue/)
  assert.doesNotMatch(createFn, /return hydrateSession\(mapSessionRow\(data\)\)\s*$/m)
})

test('wizard Start Migration only creates the session; server bootstrap owns the queue row', () => {
  const wizard = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const runImport = wizard.slice(
    wizard.indexOf('async function runImport()'),
    wizard.indexOf('async function resumeBlockedSession()'),
  )
  assert.match(runImport, /\/api\/import-export\/migration-sessions/)
  // Must not call module import or job-run endpoints from the wizard click path.
  assert.doesNotMatch(runImport, /\/api\/import-export\/\$\{/)
  assert.doesNotMatch(runImport, /\/jobs\/[^'"\s]+\/run/)

  // Provider coordination remains a fallback for later modules, not the start gate.
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  assert.match(provider, /action\.type === 'create-job'/)
  assert.match(provider, /jobs\/\$\{unfinished\.jobId\}\/run/)
})

test('idle-backend migrate contract: queue row is part of session create, not a later poll', () => {
  // Architectural regression for the measured 2m33s + 1m06s gaps:
  // with an idle backend, those writes must happen inside createQuickBooksMigrationSession
  // before POST returns — not across MigrationSessionProvider poll/coordinate cycles.
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const bootstrap = service.slice(
    service.indexOf('export async function bootstrapQuickBooksMigrationQueue'),
    service.indexOf('export async function updateQuickBooksMigrationSession'),
  )

  const createIdx = bootstrap.indexOf('createImportJob')
  const enqueueIdx = bootstrap.indexOf('enqueueJob')
  assert.ok(createIdx >= 0, 'bootstrap must create the import job')
  assert.ok(enqueueIdx > createIdx, 'bootstrap must enqueue after creating the import job')

  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  assert.match(provider, /POLL_INTERVAL_MS = 1_500/)
  // Polling must not be the mechanism that inserts the first queue row.
  assert.doesNotMatch(provider, /enqueueJob/)
})

test('QuickBooks scheduling uses durable dependency readiness rather than only display order', () => {
  const ordered = orderQuickBooksMigrationResources([
    { key: 'invoices' },
    { key: 'customers' },
    { key: 'accounts' },
    { key: 'preferences' },
  ])
  assert.deepEqual(ordered.map((item) => item.key), ['preferences', 'accounts', 'customers', 'invoices'])
  const selected = new Set(['preferences', 'accounts', 'customers', 'invoices'])
  assert.equal(quickBooksResourceDependenciesCompleted('invoices', selected, new Set(['preferences', 'accounts'])), false)
  assert.equal(quickBooksResourceDependenciesCompleted('invoices', selected, new Set(['preferences', 'accounts', 'customers'])), true)
})

test('worker completion advances the next module without the browser', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(workers, /advanceQuickBooksMigrationAfterImportJob\(/)
  assert.match(service, /export async function advanceQuickBooksMigrationAfterImportJob/)
  assert.match(service, /planMigrationStartBootstrap\(session\)/)
  assert.match(service, /migrationResourceKey: module\.key/)
})

test('current sessions are explicitly worker-owned and browser coordination exits before side effects', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const coordinate = provider.slice(provider.indexOf('const coordinate = useCallback'), provider.indexOf('  }, [patchSession, refresh])', provider.indexOf('const coordinate = useCallback')))
  assert.equal(isWorkerOwnedQuickBooksMigration({ orchestrationOwner: 'worker' }), true)
  assert.equal(isWorkerOwnedQuickBooksMigration({}), false)
  assert.match(coordinate, /isWorkerOwnedQuickBooksMigration\(current\.config\)\) return/)
  assert.ok(coordinate.indexOf('isWorkerOwnedQuickBooksMigration') < coordinate.indexOf('nextCoordinationAction'))
  assert.match(read('src/lib/import-export/wizard/migration-session.ts'), /orchestrationOwner: input\.orchestrationOwner \?\? QUICKBOOKS_MIGRATION_ORCHESTRATION_OWNER/)
})

test('legacy sessions remain distinguishable from current worker-owned sessions', () => {
  assert.equal(isWorkerOwnedQuickBooksMigration({}), false)
  assert.equal(isWorkerOwnedQuickBooksMigration({ orchestrationOwner: 'browser_legacy' }), false)
})

test('worker-owned retry bootstraps server-side while legacy retry remains browser-compatible', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const retry = service.slice(service.indexOf('export async function retryQuickBooksMigrationSession'))
  assert.match(retry, /isWorkerOwnedQuickBooksMigration\(resumed\.config\)/)
  assert.match(retry, /return bootstrapQuickBooksMigrationQueue\(\{/)
  assert.match(retry, /if \(!isWorkerOwnedQuickBooksMigration\(resumed\.config\)\) return resumed/)
})

test('worker advancement and durable bootstrap reject browser-legacy ownership', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  const reconcile = service.slice(
    service.indexOf('export async function reconcileMigrationSessionForImportJob'),
    service.indexOf('/** Returns the company\'s active QuickBooks migration session'),
  )
  const bootstrap = service.slice(service.indexOf('export async function bootstrapQuickBooksMigrationQueue'))
  const advance = service.slice(service.indexOf('export async function advanceQuickBooksMigrationAfterImportJob'))

  assert.match(reconcile, /if \(!isWorkerOwnedQuickBooksMigration\(row\.config\)\) continue/)
  assert.match(reconcile, /ownedJob\?\.migration_session_id !== row\.id/)
  assert.match(bootstrap, /if \(!isWorkerOwnedQuickBooksMigration\(input\.session\.config\)\) return input\.session/)
  assert.match(advance, /if \(!isWorkerOwnedQuickBooksMigration\(candidate\.config\)\) return false/)
  assert.match(advance, /ownedJob\?\.migration_session_id !== row\.id/)
  assert.match(read('src/lib/platform/jobs/workers.ts'), /reconcileMigrationSessionForImportJob\(/)
  assert.match(read('src/lib/platform/jobs/workers.ts'), /advanceQuickBooksMigrationAfterImportJob\(/)
})
