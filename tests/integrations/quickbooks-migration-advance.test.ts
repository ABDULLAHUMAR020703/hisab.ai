import assert from 'node:assert/strict'
import test from 'node:test'
import { planMigrationStartBootstrap } from '../../src/lib/import-export/wizard/migration-session-bootstrap'
import { nextCoordinationAction } from '../../src/lib/import-export/wizard/migration-coordination'
import {
  isImportJobOwnedByMigrationSession,
  restoreLifecycleFromSession,
} from '../../src/lib/import-export/wizard/migration-session'
import { orderQuickBooksMigrationResources } from '../../src/lib/import-export/quickbooks/dependency-order'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import type {
  ModuleLifecycleEntry,
  ModuleLifecyclePhase,
  ModuleLifecycleState,
} from '../../src/lib/import-export/wizard/module-lifecycle'

function moduleEntry(
  key: string,
  order: number,
  phase: ModuleLifecyclePhase,
  jobId: string | null,
): ModuleLifecycleEntry {
  return {
    key,
    moduleKey: `qb-${key}`,
    label: key,
    order,
    phase,
    jobId,
    estimate: { records: 1, batches: 1, durationMs: 1_000 },
    preview: null,
    failure: null,
    unsupported: null,
    progress: null,
    queuePosition: null,
    durationMs: null,
    warningCount: 0,
  }
}

function preferencesThenAccountsSession(overrides?: {
  preferencesPhase?: ModuleLifecyclePhase
  jobStatus?: string
}): HydratedMigrationSession {
  const resources = orderQuickBooksMigrationResources([
    { key: 'preferences', label: 'Company Preferences', moduleKey: 'qb-preferences' },
    { key: 'accounts', label: 'Accounts', moduleKey: 'qb-accounts' },
  ])
  const preferencesPhase = overrides?.preferencesPhase ?? 'processing'
  const lifecycle: ModuleLifecycleState = {
    preferences: moduleEntry('preferences', 0, preferencesPhase, 'pref-job'),
    accounts: moduleEntry('accounts', 1, 'ready', null),
  }
  const jobs = {
    preferences: {
      id: 'pref-job',
      moduleKey: 'qb-preferences',
      status: overrides?.jobStatus ?? 'completed',
      totalRows: 1,
      processedRows: 1,
      importedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    },
  }
  const config = {
    kind: 'quickbooks_migration' as const,
    provider: 'quickbooks' as const,
    state: 'running' as const,
    selectedModules: resources,
    duplicateStrategy: 'skip' as const,
    modules: Object.values(lifecycle).map((entry) => ({
      key: entry.key,
      moduleKey: entry.moduleKey,
      label: entry.label,
      order: entry.order,
      phase: entry.phase,
      jobId: entry.jobId,
      estimate: entry.estimate,
      preview: entry.preview,
      failure: entry.failure,
      unsupported: entry.unsupported,
      warningCount: entry.warningCount,
    })),
    importJobIds: { preferences: 'pref-job' },
    startedAt: '2026-08-06T15:43:25.531Z',
    sourceLabel: 'QuickBooks Online',
    companyName: 'Sandbox Co',
    currency: 'USD',
    orchestrationOwner: 'worker' as const,
  }
  const restored = restoreLifecycleFromSession(config, jobs)
  return {
    id: 'session-advance-1',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: 'IN_PROGRESS',
    createdAt: '2026-08-06T15:43:25.648Z',
    updatedAt: '2026-08-06T15:43:25.648Z',
    lifecycle: restored,
    jobs,
    config,
  }
}

test('completed preferences with stale processing phase schedules accounts', () => {
  const session = preferencesThenAccountsSession({ preferencesPhase: 'processing', jobStatus: 'completed' })
  assert.equal(session.lifecycle.preferences?.phase, 'completed')
  const plan = planMigrationStartBootstrap(session)
  assert.equal(plan.type, 'create-and-enqueue')
  if (plan.type === 'create-and-enqueue') {
    assert.equal(plan.module.key, 'accounts')
  }
})

test('coordination uses persisted job status when module card phase is stale', () => {
  const session = preferencesThenAccountsSession({ preferencesPhase: 'processing', jobStatus: 'completed' })
  const action = nextCoordinationAction(session, new Set())
  assert.equal(action.type, 'create-job')
  if (action.type === 'create-job') {
    assert.equal(action.module.key, 'accounts')
  }
})

test('legacy roster ownership accepts import jobs missing migration_session_id', () => {
  const config = preferencesThenAccountsSession().config
  assert.equal(
    isImportJobOwnedByMigrationSession('session-advance-1', config, 'pref-job', { migration_session_id: null }),
    true,
  )
  assert.equal(
    isImportJobOwnedByMigrationSession('session-advance-1', config, 'pref-job', { migration_session_id: 'other-session' }),
    false,
  )
  assert.equal(
    isImportJobOwnedByMigrationSession('session-advance-1', config, 'pref-job', { migration_session_id: 'session-advance-1' }),
    true,
  )
})
