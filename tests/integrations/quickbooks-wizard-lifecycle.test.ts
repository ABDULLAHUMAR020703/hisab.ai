import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  activeModule,
  applyJobCreated,
  applyJobSnapshot,
  applyModuleFailure,
  applyPreviewRequestFailure,
  applyPreviewResults,
  cancelPendingModules,
  derivePhaseFromPersistedJob,
  deriveOverallProgress,
  estimateModuleWork,
  initializeModuleLifecycle,
  markModulesPreviewing,
  migrationHasStarted,
  MODULE_PHASE_LABEL,
  orderedModules,
  type ModuleLifecycleState,
  type PreviewResultLike,
} from '../../src/lib/import-export/wizard/module-lifecycle'

const read = (path: string) => readFileSync(path, 'utf8')

const SELECTION = [
  { key: 'accounts', label: 'Chart of Accounts', moduleKey: 'accounts' },
  { key: 'customers', label: 'Customers', moduleKey: 'customers' },
  { key: 'invoices', label: 'Invoices', moduleKey: 'transactions' },
  { key: 'budgets', label: 'Budgets', moduleKey: 'budgets' },
]

function keysOf(state: ModuleLifecycleState): string[] {
  return orderedModules(state).map((entry) => entry.key)
}

function phaseOf(state: ModuleLifecycleState, key: string) {
  return state[key].phase
}

test('every selected module gets a permanent card that survives every transition', () => {
  let state = initializeModuleLifecycle(SELECTION)
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  assert.ok(orderedModules(state).every((entry) => entry.phase === 'selected'))

  state = markModulesPreviewing(state)
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  assert.ok(orderedModules(state).every((entry) => entry.phase === 'previewing'))

  const previews: PreviewResultLike[] = [
    { key: 'accounts', status: 'success', count: 240, sampleRows: [{}, {}], validation: { errorCount: 1 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [{}], validation: { errorCount: 0 } },
    { key: 'budgets', status: 'unsupported', message: 'QuickBooks resource budgets has no provider mapping.', errorCode: 'MODULE_UNSUPPORTED' },
  ]
  state = applyPreviewResults(state, previews)
  // "invoices" was requested but absent from the response: it stays visible as a failure.
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  assert.equal(phaseOf(state, 'accounts'), 'ready')
  assert.equal(phaseOf(state, 'customers'), 'ready')
  assert.equal(phaseOf(state, 'budgets'), 'unsupported')
  assert.equal(phaseOf(state, 'invoices'), 'preview_failed')
  assert.equal(state.invoices.failure?.errorCode, 'PREVIEW_RESULT_MISSING')
  assert.equal(state.invoices.failure?.retryable, true)

  state = applyJobCreated(state, 'accounts', 'job-accounts')
  state = applyJobCreated(state, 'customers', 'job-customers')
  assert.equal(migrationHasStarted(state), true)
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])

  state = applyJobSnapshot(state, 'accounts', { status: 'processing', processedRows: 100, totalRows: 240, progressPercent: 41.67 })
  state = applyJobSnapshot(state, 'accounts', { status: 'completed', processedRows: 240, totalRows: 240, importedCount: 240, progressPercent: 100, durationMs: 135_000 })
  state = applyJobSnapshot(state, 'customers', { status: 'failed', processedRows: 4, totalRows: 26 })

  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  assert.equal(phaseOf(state, 'accounts'), 'completed')
  assert.equal(phaseOf(state, 'customers'), 'failed')
  assert.equal(phaseOf(state, 'budgets'), 'unsupported')
  assert.equal(phaseOf(state, 'invoices'), 'preview_failed')
})

test('preview success exposes record, batch, and duration estimates', () => {
  const estimate = estimateModuleWork(240)
  assert.equal(estimate.records, 240)
  assert.equal(estimate.batches, 3)
  assert.ok(estimate.durationMs > 0)
  assert.equal(estimateModuleWork(0).batches, 1)

  let state = markModulesPreviewing(initializeModuleLifecycle(SELECTION))
  state = applyPreviewResults(state, [{ key: 'accounts', status: 'success', count: 90, countAccuracy: 'upper-bound', sampleRows: [{}, {}, {}], validation: { errorCount: 2 } }])
  assert.deepEqual(state.accounts.estimate, { records: 90, batches: 1, durationMs: estimateModuleWork(90).durationMs })
  assert.equal(state.accounts.preview?.sampleRowCount, 3)
  assert.equal(state.accounts.preview?.sampleErrorCount, 2)
  assert.equal(state.accounts.preview?.countAccuracy, 'upper-bound')
})

test('failed previews keep the provider response and a retry affordance', () => {
  let state = markModulesPreviewing(initializeModuleLifecycle(SELECTION))
  state = applyPreviewResults(state, [
    { key: 'accounts', status: 'error', stage: 'quickbooks_request', errorCode: 'QUICKBOOKS_REQUEST_FAILED', message: 'QuickBooks returned 503.', correlationId: 'corr-1' },
    { key: 'budgets', status: 'error', stage: 'adapter_initialization', errorCode: 'ADAPTER_RESOURCE_MISSING', message: 'No adapter resource.', correlationId: 'corr-2' },
  ])

  assert.equal(phaseOf(state, 'accounts'), 'preview_failed')
  assert.deepEqual(state.accounts.failure, {
    message: 'QuickBooks returned 503.',
    stage: 'quickbooks_request',
    errorCode: 'QUICKBOOKS_REQUEST_FAILED',
    correlationId: 'corr-1',
    retryable: true,
  })
  assert.equal(state.budgets.failure?.retryable, false, 'missing adapters are not retryable')

  // Retrying one module must not hide the others.
  state = markModulesPreviewing(state, ['accounts'])
  assert.equal(phaseOf(state, 'accounts'), 'previewing')
  assert.equal(phaseOf(state, 'budgets'), 'preview_failed')
  state = applyPreviewResults(state, [{ key: 'accounts', status: 'success', count: 12, sampleRows: [], validation: { errorCount: 0 } }])
  assert.equal(phaseOf(state, 'accounts'), 'ready')
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
})

test('a whole-request preview failure marks every module instead of dropping them', () => {
  let state = markModulesPreviewing(initializeModuleLifecycle(SELECTION))
  state = applyPreviewRequestFailure(state, 'QuickBooks connection expired.')
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  assert.ok(orderedModules(state).every((entry) => entry.phase === 'preview_failed'))
  assert.ok(orderedModules(state).every((entry) => entry.failure?.message === 'QuickBooks connection expired.'))
})

test('queue phases are derived from the persisted import job, never labelled Pending', () => {
  assert.equal(derivePhaseFromPersistedJob({ status: 'pending' }), 'queued')
  assert.equal(derivePhaseFromPersistedJob({ status: 'processing' }), 'claimed')
  assert.equal(derivePhaseFromPersistedJob({ status: 'processing', processedRows: 10 }), 'processing')
  assert.equal(derivePhaseFromPersistedJob({ status: 'processing', currentStage: 'extraction' }), 'processing')
  assert.equal(derivePhaseFromPersistedJob({ status: 'paused' }), 'paused')
  assert.equal(derivePhaseFromPersistedJob({ status: 'cancelled' }), 'cancelled')
  assert.equal(derivePhaseFromPersistedJob({ status: 'failed' }), 'failed')
  assert.equal(derivePhaseFromPersistedJob({ status: 'completed' }), 'completed')
  assert.equal(derivePhaseFromPersistedJob({ status: 'completed', failedCount: 2 }), 'completed_with_warnings')
  assert.equal(derivePhaseFromPersistedJob({ status: 'completed', warningCount: 3 }), 'completed_with_warnings')
  assert.equal(derivePhaseFromPersistedJob({ status: 'completed', invalidRows: 1 }), 'completed_with_warnings')

  assert.equal(MODULE_PHASE_LABEL.queued, 'Waiting in Queue')
  assert.equal(MODULE_PHASE_LABEL.claimed, 'Worker Claimed')
  assert.equal(MODULE_PHASE_LABEL.processing, 'Processing')
  assert.equal(MODULE_PHASE_LABEL.completed, 'Completed')
  assert.notEqual(MODULE_PHASE_LABEL.queued, 'Pending')
})

test('queued modules stay visible with a queue position while another module runs', () => {
  let state = applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION)), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'budgets', status: 'unsupported', message: 'Unsupported.', errorCode: 'MODULE_UNSUPPORTED' },
  ])

  state = applyJobCreated(state, 'accounts', 'job-1')
  state = applyJobCreated(state, 'customers', 'job-2')
  state = applyJobCreated(state, 'invoices', 'job-3')
  assert.equal(state.accounts.queuePosition, 1)
  assert.equal(state.customers.queuePosition, 2)
  assert.equal(state.invoices.queuePosition, 3)

  state = applyJobSnapshot(state, 'accounts', { status: 'processing', processedRows: 5, totalRows: 90 })
  assert.equal(state.accounts.queuePosition, null, 'a running module is no longer queued')
  assert.equal(state.customers.queuePosition, 1)
  assert.equal(state.invoices.queuePosition, 2)
  assert.equal(phaseOf(state, 'customers'), 'queued')
  assert.equal(activeModule(state)?.key, 'accounts')
  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
})

test('processing modules update live and never regress', () => {
  let state = applyJobCreated(
    applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION)), [
      { key: 'accounts', status: 'success', count: 240, sampleRows: [], validation: { errorCount: 0 } },
    ]),
    'accounts',
    'job-1',
  )

  state = applyJobSnapshot(state, 'accounts', { status: 'processing', processedRows: 100, totalRows: 240, importedCount: 100, progressPercent: 41.67, currentStage: 'materialization', currentBatch: 1, totalBatches: 3, elapsedMs: 20_000, averageThroughput: 5 })
  assert.equal(phaseOf(state, 'accounts'), 'processing')
  assert.equal(state.accounts.progress?.processedRows, 100)
  assert.equal(state.accounts.progress?.currentStage, 'materialization')

  state = applyJobSnapshot(state, 'accounts', { status: 'processing', processedRows: 200, totalRows: 240, importedCount: 200, progressPercent: 83.33, currentBatch: 2, elapsedMs: 45_000 })
  assert.equal(state.accounts.progress?.processedRows, 200)
  assert.equal(state.accounts.progress?.currentBatch, 2)

  // A stale continuation read arrives out of order: no counter may go backwards.
  state = applyJobSnapshot(state, 'accounts', { status: 'pending', processedRows: 100, totalRows: 240, importedCount: 100, progressPercent: 41.67, currentBatch: 1, elapsedMs: 20_000 })
  assert.equal(state.accounts.progress?.processedRows, 200)
  assert.equal(state.accounts.progress?.importedCount, 200)
  assert.equal(state.accounts.progress?.progressPercent, 83.33)
  assert.equal(state.accounts.progress?.currentBatch, 2)
  assert.equal(state.accounts.progress?.elapsedMs, 45_000)

  state = applyJobSnapshot(state, 'accounts', { status: 'completed', processedRows: 240, totalRows: 240, importedCount: 238, skippedCount: 2, progressPercent: 100, durationMs: 135_000, warningCount: 1 })
  assert.equal(phaseOf(state, 'accounts'), 'completed_with_warnings')
  assert.equal(state.accounts.durationMs, 135_000)
  assert.equal(state.accounts.warningCount, 1)

  // A late poll response cannot resurrect a finished module.
  state = applyJobSnapshot(state, 'accounts', { status: 'processing', processedRows: 220, totalRows: 240 })
  assert.equal(phaseOf(state, 'accounts'), 'completed_with_warnings')
  assert.equal(state.accounts.progress?.processedRows, 240)
})

test('completed modules remain visible after the migration finishes', () => {
  let state = applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION)), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'budgets', status: 'unsupported', message: 'Unsupported.', errorCode: 'MODULE_UNSUPPORTED' },
  ])
  for (const key of ['accounts', 'customers', 'invoices']) state = applyJobCreated(state, key, `job-${key}`)
  state = applyJobSnapshot(state, 'accounts', { status: 'completed', processedRows: 90, totalRows: 90, importedCount: 90, progressPercent: 100, durationMs: 135_000 })
  state = applyJobSnapshot(state, 'customers', { status: 'completed', processedRows: 26, totalRows: 26, importedCount: 26, progressPercent: 100, durationMs: 40_000 })
  state = applyJobSnapshot(state, 'invoices', { status: 'completed', processedRows: 31, totalRows: 31, importedCount: 30, skippedCount: 1, progressPercent: 100, durationMs: 55_000 })

  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices', 'budgets'])
  const summary = deriveOverallProgress(state)
  assert.equal(summary.total, 3, 'unsupported modules are not counted as migration work')
  assert.equal(summary.excluded, 1)
  assert.equal(summary.completed, 3)
  assert.equal(summary.percent, 100)
  assert.equal(summary.importedCount, 146)
  assert.equal(summary.skippedCount, 1)
  assert.equal(activeModule(state), null)
})

test('overall progress blends completed modules with the running module', () => {
  let state = applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION.slice(0, 3))), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
  ])
  for (const key of ['accounts', 'customers', 'invoices']) state = applyJobCreated(state, key, `job-${key}`)
  assert.equal(deriveOverallProgress(state).percent, 0)

  state = applyJobSnapshot(state, 'accounts', { status: 'completed', processedRows: 90, totalRows: 90, importedCount: 90, progressPercent: 100 })
  state = applyJobSnapshot(state, 'customers', { status: 'processing', processedRows: 13, totalRows: 26, progressPercent: 50 })
  const summary = deriveOverallProgress(state)
  assert.equal(summary.completed, 1)
  assert.equal(summary.processing, 1)
  assert.equal(summary.queued, 1)
  assert.equal(summary.percent, 50)
})

test('modules that never run are cancelled rather than left claiming to be queued', () => {
  let state = applyPreviewResults(markModulesPreviewing(initializeModuleLifecycle(SELECTION.slice(0, 3))), [
    { key: 'accounts', status: 'success', count: 90, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'customers', status: 'success', count: 26, sampleRows: [], validation: { errorCount: 0 } },
    { key: 'invoices', status: 'success', count: 31, sampleRows: [], validation: { errorCount: 0 } },
  ])
  for (const key of ['accounts', 'customers', 'invoices']) state = applyJobCreated(state, key, `job-${key}`)
  state = applyJobSnapshot(state, 'accounts', { status: 'failed', processedRows: 3, totalRows: 90 })
  state = applyModuleFailure(state, 'accounts', 'Chart of Accounts: migration job ended with status failed')
  state = cancelPendingModules(state, 'Migration stopped before this module started.')

  assert.deepEqual(keysOf(state), ['accounts', 'customers', 'invoices'])
  assert.equal(phaseOf(state, 'accounts'), 'failed')
  assert.equal(phaseOf(state, 'customers'), 'cancelled')
  assert.equal(phaseOf(state, 'invoices'), 'cancelled')
  assert.equal(state.customers.failure?.message, 'Migration stopped before this module started.')
  assert.equal(deriveOverallProgress(state).cancelled, 2)
})

test('applyModuleFailure never overwrites a persisted terminal outcome', () => {
  let state = applyJobCreated(initializeModuleLifecycle(SELECTION.slice(0, 1)), 'accounts', 'job-1')
  state = applyJobSnapshot(state, 'accounts', { status: 'completed', processedRows: 90, totalRows: 90, importedCount: 90, progressPercent: 100 })
  state = applyModuleFailure(state, 'accounts', 'network blip after completion')
  assert.equal(phaseOf(state, 'accounts'), 'completed')
  assert.equal(state.accounts.failure, null)
})

test('the wizard renders permanent lifecycle cards and derives state from persisted jobs', () => {
  const wizard = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')

  assert.match(wizard, /ModuleLifecycleList/)
  assert.match(wizard, /function ModuleLifecycleCard/)
  assert.match(wizard, /data-module-key=\{entry\.key\}/)
  assert.match(wizard, /data-module-phase=\{entry\.phase\}/)
  assert.match(wizard, /Queue position \{entry\.queuePosition\}/)
  assert.match(wizard, /Retry preview/)
  assert.match(wizard, /estimated records/)
  assert.match(wizard, /estimated batches|batches ·/)
  assert.match(wizard, /Provider response/)
  assert.match(wizard, /Documentation/)

  // Every step after preview keeps the module list mounted.
  const validationStep = wizard.slice(wizard.lastIndexOf("{!showBlockedGate && step === 'validation' &&"), wizard.lastIndexOf("{!showBlockedGate && step === 'import' &&"))
  const importStep = wizard.slice(wizard.lastIndexOf("{!showBlockedGate && step === 'import' &&"), wizard.lastIndexOf("{!showBlockedGate && step === 'report' &&"))
  const reportStep = wizard.slice(wizard.lastIndexOf("{!showBlockedGate && step === 'report' &&"))
  for (const section of [validationStep, importStep, reportStep]) assert.match(section, /<ModuleLifecycleList/)

  // Configuration wizard only — live progress lives in Migration Center from persisted jobs.
  assert.match(wizard, /Starting Migration Center/)
  assert.match(wizard, /onSuccess\?\.\(createdSession\.session\.id\)/)
  assert.match(wizard, /persistentSession/)
  assert.doesNotMatch(wizard, /fetch\('\/api\/import-export\/migration-sessions', \{ cache: 'no-store' \}\)/)
  assert.doesNotMatch(wizard, /deriveOverallProgress\(lifecycle\)/)
  assert.doesNotMatch(wizard, /moduleStates/)
  assert.doesNotMatch(wizard, /setJobProgress/)
  assert.doesNotMatch(wizard, /Date\.now\(\) - moduleStartedAt/)
  assert.doesNotMatch(wizard, /progress\.status === 'pending' \? 'Queued'/)
})
