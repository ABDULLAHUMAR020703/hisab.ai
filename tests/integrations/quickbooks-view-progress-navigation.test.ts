import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  navigationTarget,
  resolveMigrateEntryAction,
  resolveNavigation,
} from '../../src/lib/import-export/wizard/migration-navigation'
import { migrationCenterPath } from '../../src/lib/import-export/wizard/migration-center-view'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = () => read('src/components/import-export/MigrationSessionProvider.tsx')

/** Minimal model of the provider latch: one pending target, released on commit. */
function navigator(startingTarget: string) {
  let currentTarget = startingTarget
  let pendingTarget: string | null = null
  const pushes: string[] = []
  return {
    pushes,
    request(target: string) {
      if (pendingTarget && currentTarget === pendingTarget) pendingTarget = null
      const decision = resolveNavigation({ target, currentTarget, pendingTarget })
      if (decision === 'push') {
        pendingTarget = target
        pushes.push(target)
      }
      return decision
    },
    /** The route transition committing, which is what ends the pending state. */
    commit() {
      if (pendingTarget) currentTarget = pendingTarget
    },
  }
}

test('View Progress navigates exactly once no matter how often it is requested', () => {
  const target = migrationCenterPath('session-1')
  const nav = navigator('/migration-wizard')

  assert.equal(nav.request(target), 'push')
  // Every polling tick re-renders the indicator and can re-request the same route.
  for (let tick = 0; tick < 40; tick += 1) {
    assert.equal(nav.request(target), 'transition-pending')
  }
  assert.deepEqual(nav.pushes, [target])

  nav.commit()
  for (let tick = 0; tick < 40; tick += 1) {
    assert.equal(nav.request(target), 'already-there')
  }
  assert.deepEqual(nav.pushes, [target])
})

test('a pending transition can neither be cancelled nor restarted by polling', () => {
  const target = migrationCenterPath('session-1')
  const nav = navigator('/migration-wizard')

  nav.request(target)
  // Repeated requests while the transition is in flight are dropped, not re-pushed.
  assert.equal(nav.request(target), 'transition-pending')
  assert.equal(nav.pushes.length, 1)

  // A genuinely different destination still navigates.
  assert.equal(nav.request('/migration-history'), 'push')
  assert.deepEqual(nav.pushes, [target, '/migration-history'])
})

test('opening the wizard during an active migration redirects exactly once', () => {
  const target = migrationCenterPath('session-9')
  const nav = navigator('/migration-wizard')

  // Wizard page mount effect, wizard modal bootstrap detection, and the indicator
  // can all ask for the same redirect before the transition commits.
  assert.equal(nav.request(target), 'push')
  assert.equal(nav.request(target), 'transition-pending')
  assert.equal(nav.request(target), 'transition-pending')
  nav.commit()
  assert.equal(nav.request(target), 'already-there')
  assert.deepEqual(nav.pushes, [target])
})

test('completed migrations do not steal the Migrate entry into Migration Center', () => {
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 'done', config: { state: 'completed' } }),
    { type: 'open-wizard' },
  )
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 'live', config: { state: 'running' } }),
    { type: 'open-migration-center', sessionId: 'live' },
  )
})

test('hash targets are deduplicated independently of the plain route', () => {
  const path = migrationCenterPath('session-1')
  assert.equal(navigationTarget({ pathname: path, hash: '#logs' }), `${path}#logs`)
  assert.equal(navigationTarget({ pathname: path }), path)

  const nav = navigator(path)
  assert.equal(nav.request(path), 'already-there')
  assert.equal(nav.request(`${path}#logs`), 'push')
  assert.equal(nav.request(`${path}#logs`), 'transition-pending')
  assert.deepEqual(nav.pushes, [`${path}#logs`])
})

test('the provider pushes routes from exactly one guarded call site', () => {
  const source = provider()

  assert.equal(source.match(/router\.push\(/g)?.length, 1)
  assert.match(source, /const navigateOnce = useCallback\(\(target: string\) => \{[\s\S]*?router\.push\(target\)\n {2}\}, \[releaseNavigationLatch, router, syncNavigationLatch\]\)/)
  assert.match(source, /if \(decision === 'transition-pending'\) return/)
  assert.match(source, /pendingNavigationRef\.current = target/)
  assert.match(source, /navigateOnce\(migrationCenterPath\(id\)\)/)
  assert.match(source, /navigateOnce\(migrationCenterPath\(createdSessionId\)\)/)
  assert.match(source, /navigateOnce\(`\$\{migrationCenterPath\(session\.id\)\}#logs`\)/)
})

test('openViewer never runs while a Migration Center transition is pending', () => {
  const source = provider()

  const openViewerBody = source.slice(
    source.indexOf('const openViewer = useCallback'),
    source.indexOf('const closeViewer'),
  )
  assert.match(openViewerBody, /syncNavigationLatch\(\)/)
  assert.match(openViewerBody, /if \(pendingNavigationRef\.current\) return/)
  assert.ok(
    openViewerBody.indexOf('if (pendingNavigationRef.current) return')
      < openViewerBody.indexOf('openMigrationCenter'),
    'the pending-transition guard must run before any navigation or modal state',
  )

  // The latch is released on commit and by a bounded fallback, so retries stay possible.
  assert.match(source, /NAVIGATION_LATCH_MS = 5_000/)
  assert.match(source, /const syncNavigationLatch = useCallback/)
  assert.match(source, /currentNavigationTarget\(\) === pending\) releaseNavigationLatch\(\)/)
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?pendingNavigationRef\.current = null/)
  assert.match(source, /window\.clearTimeout\(navigationTimerRef\.current\)/)
})

test('background polling and session restoration stay independent of navigation', () => {
  const source = provider()

  const pollingEffect = source.slice(
    source.indexOf('const timer = window.setInterval'),
    source.indexOf('window.addEventListener'),
  )
  assert.doesNotMatch(pollingEffect, /navigateOnce|router|openViewer|openMigrationCenter/)

  const refreshBody = source.slice(
    source.indexOf('const refresh = useCallback'),
    source.indexOf('const patchSession'),
  )
  assert.doesNotMatch(refreshBody, /navigateOnce|router\./)
  assert.match(refreshBody, /setSession\(nextSession\)/)

  const coordinateBody = source.slice(
    source.indexOf('const coordinate = useCallback'),
    source.indexOf('useEffect(() => {\n    mountedRef.current = true'),
  )
  assert.doesNotMatch(coordinateBody, /navigateOnce|router\./)

  // Polling itself is untouched: one interval, same cadence, latch cleared on unmount.
  assert.match(source, /POLL_INTERVAL_MS = 1_500/)
  assert.equal(source.match(/window\.setInterval/g)?.length, 1)
  assert.match(source, /window\.clearInterval\(timer\)\n {6}releaseNavigationLatch\(\)/)
})

test('the wizard page opens the viewer once per mount', () => {
  const page = read('src/app/(dashboard)/migration-wizard/page.tsx')

  assert.match(page, /const openedRef = useRef\(false\)/)
  assert.match(page, /if \(sessionLoading \|\| openedRef\.current\) return\n {4}openedRef\.current = true\n {4}openViewer\(\)/)
  assert.match(page, /\}, \[openViewer, sessionLoading\]\)/)
  assert.equal(page.match(/openViewer\(\)/g)?.length, 1)
})
