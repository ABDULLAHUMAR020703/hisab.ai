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
  assert.match(service, /progress_snapshot: merged\.progressSnapshot/)
  assert.match(service, /activity_events: events/)
  assert.match(service, /progress\.stale_ignored/)
  assert.match(service, /completed_job_immutable/)
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
  assert.match(worker, /runImportJobStep\(importJobId, companyId, userId, ownership\)/)
  assert.match(importRoute, /getImportJob\(jobId, companyId\)/)
  assert.match(importRoute, /setImportJobStatus\(job\.id, 'processing'\)/)
  assert.match(importRoute, /updateImportJobProgress\([\s\S]*companyId\)/)
  assert.match(importRoute, /runImportJobStep\(jobId: string, companyId: string, userId: string, ownership\?:/)
  assert.match(service, /progress\.persist_attempt/)
  assert.match(service, /progress\.persisted/)
  assert.match(service, /updatePayload: patch/)
  assert.match(service, /IMPORT_JOB_NOT_FOUND/)
  assert.match(runRoute, /platformJobId: queued\.id/)
  assert.match(read('src/app/api/import-export/jobs/[jobId]/route.ts'), /progress\.response/)
  assert.doesNotMatch(importRoute, /progressWrite = progressWrite\.then\([\s\S]*catch\(\(\) => undefined\)/)
})

test('completed import responses enforce processed-row consistency', () => {
  const service = read('src/lib/import-export/jobs/import-job.service.ts')
  const api = read('src/app/api/import-export/jobs/[jobId]/route.ts')
  const workerRoute = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(service, /const processedRows = input\.importedCount \+ input\.updatedCount \+ input\.skippedCount \+ input\.failedCount/)
  assert.match(service, /processed_rows: processedRows/)
  assert.match(api, /const persistedOutcomeRows = job\.importedCount \+ job\.updatedCount \+ job\.skippedCount \+ job\.failedCount/)
  assert.match(api, /const progressPercent = completed \? 100/)
  assert.match(api, /progressPercent: 100/)
  assert.match(workerRoute, /Math\.max\(job\.processedRows, snapshot\.processedRecords \?\? 0\)/)
})

test('migration center renders the live enterprise dashboard from persisted session', () => {
  const center = read('src/components/import-export/MigrationCenter.tsx')
  const view = read('src/lib/import-export/wizard/migration-center-view.ts')
  assert.match(center, /Overall Progress/)
  assert.match(center, /Activity Timeline/)
  assert.match(center, /Performance Metrics/)
  assert.match(center, /Current Module/)
  assert.match(center, /Current Stage/)
  assert.match(view, /buildMigrationCenterView/)
  assert.match(view, /estimatedRemainingSeconds/)
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
