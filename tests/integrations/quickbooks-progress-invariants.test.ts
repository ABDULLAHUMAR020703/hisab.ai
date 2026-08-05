import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  finalizeProgressSnapshot,
  mergeImportJobProgress,
} from '../../src/lib/import-export/jobs/progress-merge'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const baseState = {
  status: 'processing',
  processedRows: 100,
  totalRows: 200,
  importedCount: 40,
  updatedCount: 20,
  skippedCount: 30,
  failedCount: 10,
  validRows: 90,
  invalidRows: 10,
  warningCount: 2,
  progressSnapshot: {
    processedRecords: 100,
    estimatedTotalRecords: 200,
    importedCount: 40,
    updatedCount: 20,
    skippedCount: 30,
    failedCount: 10,
    progressPercent: 50,
    currentStage: 'materialization',
  },
}

test('multi-page progress merges page-local values into cumulative totals', () => {
  const merged = mergeImportJobProgress(baseState, {
    processedRows: 25,
    totalRows: 225,
    counts: {
      importedCount: 45,
      updatedCount: 22,
      skippedCount: 33,
      failedCount: 12,
    },
    progressSnapshot: {
      processedRecords: 25,
      estimatedTotalRecords: 225,
      importedCount: 5,
      updatedCount: 2,
      skippedCount: 3,
      failedCount: 2,
      currentStage: 'materialization',
    },
  })

  assert.notEqual(merged, 'stale_completed')
  if (merged === 'stale_completed') return
  assert.equal(merged.processedRows, 112)
  assert.equal(merged.importedCount, 45)
  assert.equal(merged.updatedCount, 22)
  assert.equal(merged.skippedCount, 33)
  assert.equal(merged.failedCount, 12)
  assert.equal(merged.totalRows, 225)
  assert.equal(merged.progressSnapshot.processedRecords, 112)
  assert.ok((merged.progressPercent ?? 0) >= 50)
})

test('continuation progress never regresses processed rows or percent', () => {
  const first = mergeImportJobProgress(baseState, {
    processedRows: 140,
    totalRows: 200,
    counts: { importedCount: 50, updatedCount: 25, skippedCount: 35, failedCount: 10 },
    progressSnapshot: { processedRecords: 140, progressPercent: 70 },
  })
  assert.notEqual(first, 'stale_completed')
  if (first === 'stale_completed') return

  const second = mergeImportJobProgress({
    ...baseState,
    processedRows: first.processedRows,
    importedCount: first.importedCount,
    updatedCount: first.updatedCount,
    skippedCount: first.skippedCount,
    failedCount: first.failedCount,
    totalRows: first.totalRows,
    progressSnapshot: first.progressSnapshot,
  }, {
    processedRows: 10,
    totalRows: 200,
    counts: { importedCount: 41, updatedCount: 20, skippedCount: 30, failedCount: 10 },
    progressSnapshot: { processedRecords: 10, progressPercent: 5, currentStage: 'extraction' },
  })

  assert.notEqual(second, 'stale_completed')
  if (second === 'stale_completed') return
  assert.equal(second.processedRows, first.processedRows)
  assert.equal(second.importedCount, first.importedCount)
  assert.ok(second.progressPercent >= first.progressPercent)
  assert.equal(second.progressSnapshot.processedRecords, first.processedRows)
})

test('completed jobs ignore late progress callbacks as stale updates', () => {
  const stale = mergeImportJobProgress({
    ...baseState,
    status: 'completed',
  }, {
    processedRows: 1,
    counts: { importedCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 },
    progressSnapshot: { processedRecords: 1, currentStage: 'extraction' },
  })
  assert.equal(stale, 'stale_completed')

  const service = read('src/lib/import-export/jobs/import-job.service.ts')
  assert.match(service, /progress\.stale_ignored/)
  assert.match(service, /completed_job_immutable/)
  assert.match(service, /\.neq\('status', 'completed'\)/)
})

test('counters remain internally consistent and snapshot matches persisted totals', () => {
  const merged = mergeImportJobProgress(baseState, {
    processedRows: 160,
    totalRows: 200,
    counts: { importedCount: 70, updatedCount: 30, skippedCount: 40, failedCount: 20 },
  })
  assert.notEqual(merged, 'stale_completed')
  if (merged === 'stale_completed') return

  assert.equal(merged.importedCount + merged.updatedCount + merged.skippedCount + merged.failedCount, 160)
  assert.equal(merged.progressSnapshot.processedRecords, merged.processedRows)
  assert.equal(merged.progressSnapshot.importedCount, merged.importedCount)
  assert.equal(merged.progressSnapshot.updatedCount, merged.updatedCount)
  assert.equal(merged.progressSnapshot.skippedCount, merged.skippedCount)
  assert.equal(merged.progressSnapshot.failedCount, merged.failedCount)

  const finalized = finalizeProgressSnapshot(merged.progressSnapshot, {
    status: 'completed',
    processedRows: 160,
    totalRows: 200,
    importedCount: 70,
    updatedCount: 30,
    skippedCount: 40,
    failedCount: 20,
  })
  assert.equal(finalized.processedRecords, 160)
  assert.equal(finalized.progressPercent, 100)
  assert.equal(finalized.importedCount, 70)
})

test('import route keeps multi-page and continuation progress cumulative', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(route, /const absoluteProcessed = sourcePage \? baseProcessedRows \+ processed : processed/)
  assert.match(route, /trace\.setTotals\(existingJob\.processedRows, existingJob\.totalRows\)/)
  assert.match(route, /enqueueJob\(\{ jobType: 'QUICKBOOKS_IMPORT_STEP'/)
  assert.match(route, /status: 'processing'/)
  assert.doesNotMatch(route, /if \(sourcePage\?\.hasMore\)[\s\S]*setImportJobStatus\(job\.id, 'pending'\)/)
})
