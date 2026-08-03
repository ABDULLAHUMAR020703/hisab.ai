import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('migration jobs persist durable observability snapshots and activity events', () => {
  const migration = read('supabase/migrations/063_import_job_observability.sql')
  const service = read('src/lib/import-export/jobs/import-job.service.ts')
  const route = read('src/app/api/import-export/jobs/[jobId]/route.ts')
  const trace = read('src/lib/import-export/quickbooks/migration-telemetry.ts')

  assert.match(migration, /ADD COLUMN IF NOT EXISTS progress_snapshot JSONB/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS activity_events JSONB/)
  assert.match(service, /progress_snapshot = observability\.progressSnapshot/)
  assert.match(service, /activity_events = \[\.\.\.events, observability\.activityEvent\]/)
  assert.match(route, /estimatedCompletionAt/)
  assert.match(route, /activityEvents: job\.activityEvents/)
  assert.match(trace, /emitEvent\('stage_started'/)
  assert.match(trace, /emitEvent\('batch_completed'/)
  assert.match(trace, /apiRequests/)
  assert.match(trace, /databaseWrites/)
})

test('worker progress is bound to the queued import job and failures are observable', () => {
  const service = read('src/lib/import-export/jobs/import-job.service.ts')
  const worker = read('src/lib/platform/jobs/workers.ts')
  const runRoute = read('src/app/api/import-export/jobs/[jobId]/run/route.ts')
  const importRoute = read('src/app/api/import-export/[module]/import/route.ts')

  assert.match(runRoute, /importJobId: job\.id/)
  assert.match(worker, /runImportJobStep\(importJobId, companyId, userId\)/)
  assert.match(importRoute, /getImportJob\(jobId, companyId\)/)
  assert.match(importRoute, /setImportJobStatus\(job\.id, 'processing'\)/)
  assert.match(importRoute, /updateImportJobProgress\([\s\S]*companyId\)/)
  assert.match(service, /progress\.persist_attempt/)
  assert.match(service, /progress\.persisted/)
  assert.match(service, /IMPORT_JOB_NOT_FOUND/)
  assert.doesNotMatch(importRoute, /progressWrite = progressWrite\.then\([\s\S]*catch\(\(\) => undefined\)/)
})

test('migration wizard renders the live enterprise dashboard instead of spinner-only progress', () => {
  const wizard = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  assert.match(wizard, /MigrationDashboard/)
  assert.match(wizard, /Live activity/)
  assert.match(wizard, /Performance/)
  assert.match(wizard, /Current module/)
  assert.match(wizard, /Stage progress/)
  assert.match(wizard, /estimatedRemainingSeconds/)
})

test('performance mode profiles materialization operations and database request aggregates', () => {
  const processor = read('src/lib/import-export/import/import-processor.ts')
  const trace = read('src/lib/import-export/quickbooks/migration-telemetry.ts')
  const transactions = read('src/lib/import-export/registry/modules/transactions.module.ts')
  assert.match(processor, /measure\('native_create'/)
  assert.match(processor, /measure\('accounting_materialization'/)
  assert.match(processor, /measure\('source_hash_check'/)
  assert.match(transactions, /duplicate_batch_queries/)
  assert.match(trace, /QUICKBOOKS_PERFORMANCE_MODE/)
  assert.match(trace, /slowestOperations/)
  assert.match(trace, /totalDatabaseTimeMs/)
})
