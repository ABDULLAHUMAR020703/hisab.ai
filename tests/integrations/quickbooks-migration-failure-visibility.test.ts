import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildModuleFailureFromException,
  buildModuleFailureFromRowErrors,
  deriveModuleFailure,
} from '../../src/lib/import-export/wizard/migration-failure'
import { applyJobSnapshot, type ModuleLifecycleState } from '../../src/lib/import-export/wizard/module-lifecycle'
import { buildMigrationCenterView } from '../../src/lib/import-export/wizard/migration-center-view'
import { buildMigrationActivityTimeline } from '../../src/lib/import-export/wizard/migration-activity-timeline'
import type { HydratedMigrationSession } from '../../src/lib/import-export/wizard/migration-session'
import { MissingDependencyError } from '../../src/lib/import-export/import/import-error'

const read = (path: string) => readFileSync(path, 'utf8')

function baseEntry(overrides: Partial<ModuleLifecycleState['invoices']> = {}): ModuleLifecycleState {
  return {
    invoices: {
      key: 'invoices',
      moduleKey: 'invoices',
      label: 'Invoices',
      order: 0,
      phase: 'processing',
      jobId: 'job-inv',
      estimate: null,
      preview: null,
      failure: null,
      unsupported: null,
      progress: null,
      queuePosition: null,
      durationMs: null,
      warningCount: 0,
      ...overrides,
    },
  }
}

function failedSession(message: string): HydratedMigrationSession {
  const lifecycle = applyJobSnapshot(baseEntry(), 'invoices', {
    status: 'failed',
    currentStage: 'materialization',
    activityEvents: [
      {
        id: 'e1',
        at: '2026-08-07T10:00:00.000Z',
        type: 'stage_started',
        message: 'Started materialization',
        stage: 'materialization',
        module: 'invoices',
      },
      {
        id: 'e2',
        at: '2026-08-07T10:00:01.000Z',
        type: 'stage_failed',
        message,
        stage: 'materialization',
        module: 'invoices',
      },
    ],
    progressSnapshot: {
      currentStage: 'materialization',
      failure: {
        message,
        stage: 'materialization',
        errorCode: '23503',
        errorType: 'Error',
        correlationId: 'corr-1',
        retryable: false,
        rowNumber: null,
        stack: null,
      },
    },
  })
  return {
    id: 'session-fail',
    companyId: 'company-1',
    userId: 'user-1',
    step: 'import',
    status: 'COMPLETED',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:02.000Z',
    lifecycle,
    jobs: {
      invoices: {
        id: 'job-inv',
        moduleKey: 'invoices',
        status: 'failed',
        createdAt: '2026-08-07T10:00:00.000Z',
        updatedAt: '2026-08-07T10:00:02.000Z',
        startedAt: '2026-08-07T10:00:00.000Z',
        totalRows: 31,
        processedRows: 0,
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 31,
        currentStage: 'materialization',
        activityEvents: lifecycle.invoices.progress?.activityEvents ?? [],
        progressSnapshot: lifecycle.invoices.progress?.progressSnapshot ?? {},
      },
    },
    config: {
      kind: 'quickbooks_migration',
      provider: 'quickbooks',
      state: 'failed',
      selectedModules: [{ key: 'invoices', label: 'Invoices', moduleKey: 'invoices' }],
      duplicateStrategy: 'update',
      modules: [],
      importJobIds: { invoices: 'job-inv' },
      startedAt: '2026-08-07T10:00:00.000Z',
      sourceLabel: 'QuickBooks Online',
      companyName: 'Sandbox',
      currency: 'USD',
    },
  }
}

test('thrown exceptions become module failure snapshots with the real message', () => {
  const failure = buildModuleFailureFromException(
    new Error('Foreign key violation on customer_id.'),
    { stage: 'materialization', correlationId: 'c1', includeStack: false },
  )
  assert.equal(failure.message, 'Foreign key violation on customer_id.')
  assert.equal(failure.stage, 'materialization')
  assert.equal(failure.errorCode, 'IMPORT_FATAL')
  assert.equal(failure.errorType, 'Error')
  assert.equal(failure.retryable, false)

  const dependency = buildModuleFailureFromException(
    new MissingDependencyError('customers', '31 invoices reference missing customers.'),
    { stage: 'validation' },
  )
  assert.equal(dependency.message, '31 invoices reference missing customers.')
  assert.equal(dependency.errorCode, 'MISSING_DEPENDENCY')
  assert.equal(dependency.retryable, true)
})

test('row-error summaries keep the actionable message instead of Failed', () => {
  const failure = buildModuleFailureFromRowErrors([
    {
      rowNumber: 4,
      errorCode: 'MISSING_DEPENDENCY',
      message: '31 invoices reference missing customers.',
    },
  ], { stage: 'validation' })
  assert.ok(failure)
  assert.equal(failure!.message, '31 invoices reference missing customers.')
  assert.equal(failure!.stage, 'validation')
  assert.equal(failure!.rowNumber, 4)
})

test('applyJobSnapshot projects persisted failure onto the lifecycle card', () => {
  const next = applyJobSnapshot(baseEntry(), 'invoices', {
    status: 'failed',
    progressSnapshot: {
      failure: {
        message: 'Foreign key violation on customer_id.',
        stage: 'materialization',
        errorCode: '23503',
        errorType: 'Error',
        correlationId: null,
        retryable: false,
        rowNumber: null,
        stack: null,
      },
    },
  })
  assert.equal(next.invoices.phase, 'failed')
  assert.equal(next.invoices.failure?.message, 'Foreign key violation on customer_id.')
  assert.equal(next.invoices.failure?.stage, 'materialization')
  assert.notEqual(next.invoices.failure?.message, 'Failed')
})

test('deriveModuleFailure recovers from stage_failed activity when snapshot.failure is missing', () => {
  const failure = deriveModuleFailure(
    { failure: null, phase: 'failed' },
    {
      status: 'failed',
      currentStage: 'materialization',
      activityEvents: [{
        id: 'e1',
        at: '2026-08-07T10:00:01.000Z',
        type: 'stage_failed',
        message: 'Foreign key violation on customer_id.',
        stage: 'materialization',
      }],
    },
  )
  assert.equal(failure?.message, 'Foreign key violation on customer_id.')
  assert.equal(failure?.stage, 'materialization')
})

test('Migration Center Errors, Logs, Timeline, and Final Report expose the real exception', () => {
  const message = 'Foreign key violation on customer_id.'
  const session = failedSession(message)
  const view = buildMigrationCenterView(session, Date.parse('2026-08-07T10:00:05.000Z'), { includeHeavy: true })
  const timeline = buildMigrationActivityTimeline(session)

  assert.equal(view.errors.length, 1)
  assert.equal(view.errors[0]?.module, 'Invoices')
  assert.equal(view.errors[0]?.message, message)
  assert.equal(view.errors[0]?.stage, 'materialization')
  assert.notEqual(view.errors[0]?.message, 'Failed')

  assert.ok(view.logs.some((event) => event.message.includes(message)))
  assert.ok(timeline.some((entry) => entry.message.includes(message)))
  assert.ok(view.finalReport?.modules[0]?.errors?.some((error) => error.message === message))
})

test('failure persistence path never swallows the exception message', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  const telemetry = read('src/lib/import-export/quickbooks/migration-telemetry.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')

  assert.match(route, /buildModuleFailureFromException/)
  assert.match(route, /failure,/)
  assert.match(telemetry, /errorMessage \|\| `Failed \$\{stage/)
  assert.match(workers, /typeof payload\.error === 'string'/)
  assert.doesNotMatch(workers, /failed with HTTP \$\{response\.status\}\.`\)\n {4}await ownership/)
})
