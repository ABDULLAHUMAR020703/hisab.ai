import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

test('migration 069 provisions snapshot tables, private bucket, and the one-active-step guard', () => {
  const sql = read('supabase/migrations/069_quickbooks_migration_snapshots.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.quickbooks_migration_snapshots/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.quickbooks_snapshot_checkpoints/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.quickbooks_snapshot_read_cursors/)
  assert.match(sql, /status IN \('RUNNING','PARTIAL','COMPLETE','FAILED'\)/)
  assert.match(sql, /job_queue_one_active_quickbooks_snapshot_step_idx/)
  // One active step per snapshot, PENDING+RUNNING — same scope as the import
  // step guard (067). The successor is scheduled from the post-complete hook
  // (after COMPLETED), so a RUNNING row never has to coexist with its successor.
  assert.match(
    sql,
    /WHERE job_type = 'QUICKBOOKS_SNAPSHOT_STEP'\s*\n\s*AND status IN \('PENDING', 'RUNNING'\);/,
    'snapshot step index scope must match the import step guard',
  )
  assert.match(sql, /public = false, file_size_limit = EXCLUDED\.file_size_limit/, 'bucket must be re-asserted private')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS snapshot_id UUID/)
})

test('worker handler registered and worker loop polls the snapshot step', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  assert.match(workers, /registerJobHandler\('QUICKBOOKS_SNAPSHOT_STEP'/)
  assert.match(workers, /runSnapshotStep\(snapshotId, companyId, userId, ownership\)/)

  const worker = read('worker/index.ts')
  assert.match(worker, /\['QUICKBOOKS_IMPORT_STEP', 'QUICKBOOKS_SNAPSHOT_STEP'\]/)
})

test('snapshot continuation follows the same post-complete-hook model as the import step', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const hook = workers.slice(
    workers.indexOf("registerPostCompleteHook('QUICKBOOKS_SNAPSHOT_STEP'"),
    workers.indexOf("registerJobHandler('AUTOMATION_RUN'"),
  )
  assert.ok(hook.length > 0, 'a post-complete hook is registered for QUICKBOOKS_SNAPSHOT_STEP')
  assert.match(hook, /if \(done\) return/, 'hook only continues while the step reported more work')
  assert.match(hook, /ensureSnapshotContinuation\(\{ snapshotId, companyId, userId \}\)/)

  // The orchestrator must NOT schedule the next step itself (that would race the index).
  const orch = read('src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator.ts')
  assert.doesNotMatch(orch, /enqueueJob\(/, 'orchestrator must not enqueue steps directly')

  const scheduler = read('src/lib/platform/continuation-scheduler.ts')
  assert.match(scheduler, /export async function ensureSnapshotContinuation/)
  assert.doesNotMatch(scheduler, /recoverStalledSnapshots/, 'the bespoke snapshot recovery loop must be gone')
})

test('claimNextJob accepts an array of job types', () => {
  const queue = read('src/lib/platform/jobs/queue.ts')
  assert.match(queue, /jobType\?: string \| string\[\]/)
  assert.match(queue, /query\.in\('job_type', jobType\)/)
})

test('snapshot step reads QuickBooks through the existing connection runtime only', () => {
  const step = read('src/lib/import-export/quickbooks/snapshot/snapshot-step.ts')
  assert.match(step, /executeForProvider\(companyId, Provider\.QUICKBOOKS/)
  assert.match(step, /withCompanyContext\(companyId/)
  assert.doesNotMatch(step, /createRecord|updateRecord|deleteRecord/, 'extraction must never write to QuickBooks')
})

test('extractor writes each raw page to storage before advancing its checkpoint', () => {
  const extractor = read('src/lib/import-export/quickbooks/snapshot/snapshot-extractor.ts')
  const onPageBody = extractor.slice(extractor.indexOf('const onPage = async'), extractor.indexOf('const onCheckpoint = async'))
  const writeIdx = onPageBody.indexOf('await ports.writeRawPage(')
  const cursorIdx = onPageBody.indexOf('await ports.saveCheckpoint(spec.resourceKey, {')
  assert.ok(writeIdx > -1 && cursorIdx > -1 && writeIdx < cursorIdx, 'page upload must precede checkpoint advance')
})

test('orchestrator only marks COMPLETE when the summary is COMPLETE and validation passes', () => {
  const orch = read('src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator.ts')
  assert.match(orch, /refreshed\.status === 'COMPLETE' && validation\.ok/)
})
