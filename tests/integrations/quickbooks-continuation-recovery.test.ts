import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

test('continuation scheduler has conservative recovery guards', () => {
  const file = read('src/lib/platform/continuation-scheduler.ts')
  assert.match(file, /\.lt\('last_heartbeat_at', cutoff\)/, 'must check heartbeat staleness')
  assert.match(file, /Number\(row.processed_rows\) > 0/, 'must require a committed checkpoint')
  assert.match(file, /processed < total/, 'must require processed < total to infer hasMore')
  assert.match(file, /migration_wizard_sessions/, 'must check session cancellation before recovery')
  assert.match(file, /in\('status', \['PENDING','RUNNING'\]\)/, 'must only consider active queue rows as dedupe')
  assert.match(file, /23505/, 'must tolerate unique-index race')
})

test('enqueue logic only logs continuation_enqueued when durable job created', () => {
  const file = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(file, /sourcePage\.checkpoint\.fetched\s*\+\s*\(sourcePage\.hasMore\s*\?\s*1\s*:\s*0\)/, 'must persist sentinel total when hasMore')
  assert.match(file, /continuation_enqueued/, 'must log continuation_enqueued')
  assert.match(file, /continuation_already_active/, 'must log continuation_already_active when existing')
  assert.match(file, /quickbooks.import_job.continuation_already_queued/, 'must log DB-unique race when enqueue throws 23505')
})

test('queue unique index exists and dedupe kept at DB level', () => {
  const sql = read('supabase/migrations/067_quickbooks_durable_scheduler_guards.sql')
  assert.match(sql, /job_queue_one_active_quickbooks_step_idx/, 'unique index must exist')
  assert.match(sql, /WHERE job_type = 'QUICKBOOKS_IMPORT_STEP'/, 'index scope must be QUICKBOOKS_IMPORT_STEP')
  assert.match(sql, /AND status IN \('\w+', 'RUNNING'\)/, 'index must limit to active statuses')
})

test('worker heartbeat implemented and recovery loop started in worker startup', () => {
  const worker = read('worker/index.ts')
  assert.match(worker, /touchWorkerHeartbeat\(/, 'worker must call touchWorkerHeartbeat')
  assert.match(worker, /setInterval\(\(\) => \{ void recoverOrphanedContinuations\(\) \}, recoveryInterval\)/, 'worker must start recovery interval')
})

test('progress merge and UI treat totalRows as estimate; sentinel must not show 100% incorrectly', () => {
  const merge = read('src/lib/import-export/jobs/progress-merge.ts')
  assert.match(merge, /if \(totalRows <= 0\) return terminal \? 100 : Math.min\(99.99, Math.max\(0, previousPercent\)\)/, 'computeProgressPercent keeps non-terminal < 100%')

  const center = read('src/components/import-export/MigrationCenter.tsx')
  assert.match(center, /processedRows.*totalRows/, 'UI displays processedRows \/ totalRows')

  const session = read('src/lib/import-export/wizard/migration-session.ts')
  assert.match(session, /const totalRows = Math.max\(snapshot\.estimatedTotalRecords \?\? 0, job.totalRows, processedRows\)/, 'session composes totalRows from estimated, job.totalRows and processedRows')
})

// Regression: ensure persisted sentinel prevents ambiguous processing state when hasMore=true
test('regression: processed_rows == total_rows with hasMore=true must not be persisted', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  // ensure the persistedTotal calculation exists (fetched + (hasMore ? 1 : 0))
  assert.match(route, /const persistedTotal = Math.max\(job.totalRows \?\? 0, sourcePage.checkpoint.fetched \+ \(sourcePage.hasMore \? 1 : 0\)\)/)
  // ensure updateImportJobProgress uses persistedTotal
  assert.match(route, /updateImportJobProgress\(job.id, sourcePage.checkpoint.fetched,[\s\S]*?, persistedTotal, undefined, companyId\)/)
})

// Idempotency: ensure continuation scheduler handles 23505 and fetches existing row
test('scheduler idempotency: 23505 race handled by fetching existing active queue row', () => {
  const file = read('src/lib/platform/continuation-scheduler.ts')
  assert.match(file, /if \(\(error as \{ code\?: string \}\)\?\.code !== '23505'\) throw error/, 'non-23505 errors rethrown')
  assert.match(file, /\.filter\("payload->>importJobId", 'eq', input.importJobId\)/, 'scheduler fetches queue rows by payload importJobId')
})

// Ensure advance guard logs existing platform job when skipping due to non-terminal persisted status
test('advance guard includes existing platform job when skipped', () => {
  const svc = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(svc, /existingPlatformJobId: existing\?\.id \?\? null/, 'advance skipping log includes existingPlatformJobId')
  assert.match(svc, /existingStatus: existing\?\.status \?\? null/, 'advance skipping log includes existingStatus')
})

// Happy-path continuation: a page that still has more work schedules its own
// successor once its queue row is COMPLETED, instead of waiting for the 30s
// recovery sweep.
test('a completed processing page schedules the next continuation from a post-complete hook', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const hook = workers.slice(
    workers.indexOf("registerPostCompleteHook('QUICKBOOKS_IMPORT_STEP'"),
    workers.indexOf("registerJobHandler('AUTOMATION_RUN'"),
  )
  assert.ok(hook.length > 0, 'a post-complete hook is registered for QUICKBOOKS_IMPORT_STEP')
  // Only continues when the step itself reported more work.
  assert.match(hook, /status !== 'processing'/, 'hook is gated on the step result status')
  // Reuses the idempotent, index-guarded scheduler rather than a raw enqueue.
  assert.match(hook, /ensureContinuationForImportJob\(\{ importJobId, companyId, moduleKey, userId \}\)/)
  // Requires every payload field before scheduling.
  assert.match(hook, /if \(!importJobId \|\| !companyId \|\| !moduleKey \|\| !userId\) return/)
})

// Ordering: the hook must run strictly after the queue row is durably COMPLETED
// so the unique "one active step" index no longer blocks the insert.
test('post-complete hook runs after completeJob, never before', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const completeCall = workers.indexOf('await completeJob(jobId, (result ?? {}) as Record<string, unknown>, attempt)')
  const hookLookup = workers.indexOf('const postComplete = postCompleteHooks.get(jobType)')
  const hookInvoke = workers.indexOf('await postComplete(payload, jobId, result)')
  assert.ok(completeCall >= 0)
  assert.ok(hookLookup > completeCall, 'hook is looked up after completeJob')
  assert.ok(hookInvoke > hookLookup, 'hook is invoked after completeJob')
})

// Crash safety: a hook failure must never fail the job that already completed,
// and recoverOrphanedContinuations stays the fallback if the hook throws or
// never runs.
test('post-complete hook failure is isolated and recovery remains the safety net', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const invocation = workers.slice(
    workers.indexOf('const postComplete = postCompleteHooks.get(jobType)'),
    workers.indexOf('clearInterval(heartbeatTimer)'),
  )
  assert.match(invocation, /try \{\s*await postComplete\(payload, jobId, result\)\s*\} catch \(hookError\) \{/, 'hook invocation is wrapped in try/catch')
  assert.match(invocation, /logger\.error\('quickbooks\.worker\.post_complete_hook_failed'/, 'hook failure is logged, not rethrown')
  assert.doesNotMatch(invocation, /failJob/, 'a hook failure never routes into failJob')
  assert.doesNotMatch(invocation, /throw hookError/, 'a hook failure is swallowed')

  // The recovery loop is still started by the worker (the crash-safe fallback).
  const worker = read('worker/index.ts')
  assert.match(worker, /setInterval\(\(\) => \{ void recoverOrphanedContinuations\(\) \}, recoveryInterval\)/)
})
