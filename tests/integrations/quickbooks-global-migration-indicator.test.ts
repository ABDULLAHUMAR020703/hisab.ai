import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = () => read('src/components/import-export/MigrationSessionProvider.tsx')

test('closing the modal only hides the viewer while layout polling continues', () => {
  const source = provider()

  assert.match(source, /const closeViewer = useCallback\(\(\) => setViewerOpen\(false\)/)
  assert.match(source, /window\.setInterval\(\(\) =>/)
  assert.match(source, /POLL_INTERVAL_MS = 1_500/)
  assert.match(source, /open=\{viewerOpen\}/)
  assert.match(source, /onClose=\{\(\) => setViewerOpen\(false\)\}/)

  const closeBody = source.slice(
    source.indexOf('const closeViewer'),
    source.indexOf('const refresh'),
  )
  assert.doesNotMatch(closeBody, /clearInterval|setSession\(null\)|cancel/i)
})

test('dashboard layout owns migration coordination across route navigation', () => {
  const layout = read('src/app/(dashboard)/layout.tsx')
  const source = provider()

  assert.match(layout, /<MigrationSessionProvider>/)
  assert.match(layout, /\{children\}/)
  assert.match(layout, /<\/MigrationSessionProvider>/)
  assert.ok(
    layout.indexOf('<MigrationSessionProvider>') < layout.indexOf('{children}'),
    'provider must wrap route children',
  )
  assert.match(source, /coordinate\(coordinationSignal\)/)
  assert.match(source, /sourceKey: current\.config\.provider/)
  assert.match(source, /\/jobs\/\$\{unfinished\.jobId\}\/run/)
  assert.match(source, /usePathname\(\)/)
  assert.match(source, /migrationSessionIdFromPathname/)
})

test('running indicator stays compact without duplicating Migration Center actions', () => {
  const source = provider()

  assert.match(source, /data-global-migration-indicator=\{state\}/)
  assert.match(source, /QuickBooks Migration/)
  assert.match(source, /overall\.percent/)
  assert.match(source, /current\?\.label/)
  assert.match(source, /openMigrationCenter\(session\.id\)/)
  // Floating widget no longer hosts Cancel / View Progress / Resume.
  assert.doesNotMatch(source, /data-cancel-migration/)
  assert.doesNotMatch(source, />View Progress</)
  assert.doesNotMatch(source, /failed \? 'Resume'/)
  assert.doesNotMatch(source, />View Report</)
})

test('completed migration shows success then collapses to a circular icon after 8s', () => {
  const source = provider()
  const state = read('src/lib/import-export/wizard/migration-indicator-state.ts')

  assert.match(source, /Migration Completed/)
  assert.match(state, /COMPLETED_COLLAPSE_MS = 8_000/)
  assert.match(source, /resolveIndicatorCollapseDelayMs/)
  assert.match(source, /IndicatorAutoCollapseController/)
  assert.match(source, /data-migration-indicator-presentation/)
  assert.match(source, /collapsed/)
  assert.match(source, /expandFromIcon/)
  assert.match(source, /presentationAfterCollapseRequest/)
  assert.match(source, /Open \$\{title\} notification/)
  assert.match(source, /rounded-full/)
  assert.match(source, /h-12 w-12/)
})

test('failed migration shows View Logs and Retry only, then collapses after 10s', () => {
  const source = provider()
  const state = read('src/lib/import-export/wizard/migration-indicator-state.ts')
  const retryRoute = read('src/app/api/import-export/migration-sessions/[sessionId]/retry/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')

  assert.match(source, /Migration Failed/)
  assert.match(state, /FAILED_COLLAPSE_MS = 10_000/)
  assert.match(source, />Retry</)
  assert.match(source, />View Logs</)
  assert.doesNotMatch(source, /Resume/)
  assert.match(source, /migrationCenterPath\(session\.id\)\}#logs/)
  assert.match(source, /\/migration-sessions\/\$\{sessionId\}\/retry/)
  assert.match(retryRoute, /retryQuickBooksMigrationSession/)
  assert.match(service, /incrementImportJobRetry/)
})

test('dismiss hides the indicator for the remainder of the browser session', () => {
  const source = provider()

  assert.match(source, /dismissedIndicatorSessionIds/)
  assert.match(source, /data-dismiss-migration-indicator/)
  assert.match(source, /Dismiss migration notification/)
  assert.match(source, /dismissForSession/)
  assert.match(source, /presentation === 'dismissed'\) return null/)
  assert.match(source, /dismissedIndicatorSessionIds\.add\(session\.id\)/)
})

test('indicator expand survives polling and does not force-collapse on Migration Center', () => {
  const source = provider()

  // Root cause of the flicker: route-based force-collapse on every expand.
  assert.doesNotMatch(source, /onCenterPage/)
  assert.doesNotMatch(source, /if \(presentation === 'expanded'\) collapseToIcon/)
  // Same session id + state from polls must not rewrite presentation.
  assert.match(source, /presentationForSessionTransition/)
  assert.match(source, /Progress polls must not rewrite presentation/)
  assert.match(source, /armAutoCollapse/)
  assert.match(source, /w-\[min\(20rem,calc\(100%-2rem\)\)\]/)
})

test('indicator state persists through refresh and session completion', () => {
  const source = provider()
  const route = read('src/app/api/import-export/migration-sessions/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')

  assert.match(source, /includeLatest/)
  assert.match(source, /poll: '1'/)
  assert.match(source, /cache: 'no-store'/)
  assert.match(source, /quickbooks-migration-session-changed/)
  assert.match(source, /expandedTerminalSessionIds/)
  assert.match(route, /includeLatest/)
  assert.match(route, /findLatestQuickBooksMigrationSession/)
  assert.match(service, /including completed or failed sessions/)
})

test('modal no longer owns worker polling or migration execution', () => {
  const viewer = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const source = provider()

  assert.doesNotMatch(viewer, /while \(result\.status/)
  assert.doesNotMatch(viewer, /ensureJobRunning/)
  assert.match(viewer, /quickbooks-migration-session-changed/)
  assert.match(source, /window\.setInterval/)
  assert.match(source, /applyJobCreated/)
})

test('repeated coordinator ticks cannot enqueue duplicate active queue jobs', () => {
  const runRoute = read('src/app/api/import-export/jobs/[jobId]/run/route.ts')

  assert.match(runRoute, /activeQueueJob/)
  assert.match(runRoute, /\.in\('status', \['PENDING', 'RUNNING'\]\)/)
  assert.match(runRoute, /\.contains\('payload', \{ importJobId: job\.id \}\)/)
  assert.match(runRoute, /if \(activeQueueJob\)/)
})
