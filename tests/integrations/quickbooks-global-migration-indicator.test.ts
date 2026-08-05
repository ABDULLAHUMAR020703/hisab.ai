import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('closing the modal only hides the viewer while layout polling continues', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')

  assert.match(provider, /const closeViewer = useCallback\(\(\) => setViewerOpen\(false\)/)
  assert.match(provider, /window\.setInterval\(\(\) =>/)
  assert.match(provider, /POLL_INTERVAL_MS = 1_500/)
  assert.match(provider, /open=\{viewerOpen\}/)
  assert.match(provider, /onClose=\{\(\) => setViewerOpen\(false\)\}/)

  const closeBody = provider.slice(
    provider.indexOf('const closeViewer'),
    provider.indexOf('const refresh'),
  )
  assert.doesNotMatch(closeBody, /clearInterval|setSession\(null\)|cancel/i)
})

test('dashboard layout owns migration coordination across route navigation', () => {
  const layout = read('src/app/(dashboard)/layout.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')

  assert.match(layout, /<MigrationSessionProvider>/)
  assert.match(layout, /\{children\}/)
  assert.match(layout, /<\/MigrationSessionProvider>/)
  assert.ok(
    layout.indexOf('<MigrationSessionProvider>') < layout.indexOf('{children}'),
    'provider must wrap route children',
  )
  assert.match(provider, /coordinate\(coordinationSignal\)/)
  assert.match(provider, /sourceKey: current\.config\.provider/)
  assert.match(provider, /\/jobs\/\$\{unfinished\.jobId\}\/run/)
  assert.match(provider, /usePathname\(\)/)
  assert.match(provider, /migrationSessionIdFromPathname/)
})

test('global indicator opens Migration Center from persisted session', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')

  assert.match(provider, /data-global-migration-indicator=\{state\}/)
  assert.match(provider, /QuickBooks Migration/)
  assert.match(provider, /View Progress/)
  assert.match(provider, /overall\.percent/)
  assert.match(provider, /current\?\.label/)
  assert.match(provider, /current\?\.progress\?\.currentStage/)
  assert.match(provider, /openMigrationCenter\(session\.id\)/)
  assert.match(provider, /migrationCenterPath/)
  assert.match(provider, /Continues in background/)
})

test('completed migration indicator links to the persisted Migration Center report', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const center = read('src/components/import-export/MigrationCenter.tsx')

  assert.match(provider, /Migration Completed/)
  assert.match(provider, /View Report/)
  assert.match(provider, /state === 'completed'/)
  assert.match(provider, /openMigrationCenter/)
  assert.match(center, /Final Report/)
  assert.match(center, /buildMigrationCenterView/)
})

test('failed migration indicator exposes resume, retry, and logs actions', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const retryRoute = read('src/app/api/import-export/migration-sessions/[sessionId]/retry/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')

  assert.match(provider, /Migration Failed/)
  assert.match(provider, /failed \? 'Resume'/)
  assert.match(provider, />Retry</)
  assert.match(provider, />View Logs</)
  assert.match(provider, /migrationCenterPath\(session\.id\)\}#logs/)
  assert.match(provider, /\/migration-sessions\/\$\{sessionId\}\/retry/)
  assert.match(retryRoute, /retryQuickBooksMigrationSession/)
  assert.match(service, /incrementImportJobRetry/)
  assert.match(service, /phase: 'queued'/)
  assert.match(service, /state: 'running'/)
  assert.match(service, /status: 'IN_PROGRESS'/)
})

test('indicator state persists through refresh and session completion', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')
  const route = read('src/app/api/import-export/migration-sessions/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')

  assert.match(provider, /includeLatest/)
  assert.match(provider, /poll: '1'/)
  assert.match(provider, /cache: 'no-store'/)
  assert.match(provider, /quickbooks-migration-session-changed/)
  assert.match(route, /includeLatest/)
  assert.match(route, /findLatestQuickBooksMigrationSession/)
  assert.match(service, /including completed or failed sessions/)
  assert.match(service, /order\('updated_at', \{ ascending: false \}\)/)
})

test('modal no longer owns worker polling or migration execution', () => {
  const viewer = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')

  assert.doesNotMatch(viewer, /while \(result\.status/)
  assert.doesNotMatch(viewer, /ensureJobRunning/)
  assert.match(viewer, /quickbooks-migration-session-changed/)
  assert.match(provider, /window\.setInterval/)
  assert.match(provider, /applyJobCreated/)
})

test('repeated coordinator ticks cannot enqueue duplicate active queue jobs', () => {
  const runRoute = read('src/app/api/import-export/jobs/[jobId]/run/route.ts')

  assert.match(runRoute, /activeQueueJob/)
  assert.match(runRoute, /\.in\('status', \['PENDING', 'RUNNING'\]\)/)
  assert.match(runRoute, /\.contains\('payload', \{ importJobId: job\.id \}\)/)
  assert.match(runRoute, /if \(activeQueueJob\)/)
})

