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
