import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveMigrateEntryAction } from '../../src/lib/import-export/wizard/migration-navigation'

const read = (path: string) => readFileSync(path, 'utf8')

test('Migrate opens the wizard when there is no running migration', () => {
  assert.deepEqual(resolveMigrateEntryAction(null), { type: 'open-wizard' })
  assert.deepEqual(resolveMigrateEntryAction(undefined), { type: 'open-wizard' })
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 's1', config: { state: 'completed' } }),
    { type: 'open-wizard' },
  )
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 's1', config: { state: 'failed' } }),
    { type: 'open-wizard' },
  )
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 's1', config: { state: 'cancelled' } }),
    { type: 'open-wizard' },
  )
})

test('Migrate resumes Migration Center when a migration is actively running', () => {
  assert.deepEqual(
    resolveMigrateEntryAction({ id: 'running-1', config: { state: 'running' } }),
    { type: 'open-migration-center', sessionId: 'running-1' },
  )
})

test('Integrations Migrate never silently closes after completion banner / bootstrap sessions', () => {
  const integrations = read('src/app/(dashboard)/settings/integrations/integrations-client.tsx')
  const flow = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')

  assert.match(integrations, /const openMigrate = useCallback/)
  assert.match(integrations, /resolveMigrateEntryAction\(session\)/)
  assert.match(integrations, /openMigrationCenter\(action\.sessionId\)/)
  assert.match(integrations, /setShowImport\(true\)/)
  assert.match(integrations, /onClick=\{openMigrate\}/)
  assert.match(integrations, /onSuccess=\{handleWizardSuccess\}/)
  assert.match(integrations, /if \(sessionId\) openMigrationCenter\(sessionId\)/)

  // Must not open the modal only to immediately close it for terminal sessions.
  assert.match(flow, /resolveMigrateEntryAction\(persistentSession\)/)
  assert.match(flow, /runningSessionId/)
  assert.doesNotMatch(flow, /migrationHasStarted\(persistentSession\.lifecycle\)/)
  assert.doesNotMatch(
    integrations,
    /onClick=\{\(\) => setShowImport\(true\)\}/,
  )
})

test('wizard redirect for a running session always surfaces via onSuccess with the session id', () => {
  const flow = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const redirectEffect = flow.slice(
    flow.indexOf('if (!runningSessionId || redirectedSessionRef.current === runningSessionId) return'),
    flow.indexOf('useEffect(() => {\n    if (!open || runningSessionId) return'),
  )
  assert.match(redirectEffect, /onCloseRef\.current\(\)/)
  assert.match(redirectEffect, /onSuccessRef\.current\?\.\(runningSessionId\)/)
  // No bare return that drops the user without closing or navigating.
  assert.doesNotMatch(redirectEffect, /return\n {4}\}/)
})
