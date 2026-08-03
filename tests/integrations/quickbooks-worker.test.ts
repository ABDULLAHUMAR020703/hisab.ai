import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('standalone QuickBooks worker polls only migration continuation jobs', () => {
  const worker = read('worker/index.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')
  const queue = read('src/lib/platform/jobs/queue.ts')
  const packageJson = read('package.json')
  const dockerfile = read('Dockerfile.worker')
  const runRoute = read('src/app/api/import-export/jobs/[jobId]/run/route.ts')

  assert.match(worker, /processJobBatch\(1, 'QUICKBOOKS_IMPORT_STEP'\)/)
  assert.match(worker, /while \(!stopping\)/)
  assert.match(workers, /processJobBatch\(limit = 5, jobType\?: string\)/)
  assert.match(queue, /if \(jobType\) query = query\.eq\('job_type', jobType\)/)
  assert.match(packageJson, /"worker": "tsx .*worker\/index\.ts"/)
  assert.match(dockerfile, /CMD \["npm", "run", "worker"\]/)
  assert.match(runRoute, /enqueueJob\(\{ jobType: 'QUICKBOOKS_IMPORT_STEP'/)
  assert.match(runRoute, /status: 'pending'/)
})

test('queue ownership heartbeats prevent starvation and recover abandoned jobs', () => {
  const queue = read('src/lib/platform/jobs/queue.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')

  assert.match(queue, /JOB_QUEUE_HEARTBEAT_MS/)
  assert.match(queue, /JOB_QUEUE_STALE_MS/)
  assert.match(queue, /status', 'RUNNING'/)
  assert.match(queue, /attempts', attempt/)
  assert.match(queue, /Recovered abandoned RUNNING job after heartbeat timeout/)
  assert.match(queue, /status: 'PENDING', started_at: null, scheduled_at: now, updated_at: now/)
  assert.match(queue, /ORDER BY|order\('scheduled_at'/i)
  assert.match(queue, /status: 'FAILED'/)
  assert.match(workers, /setInterval\(\(\) => \{ void heartbeat\(\) \}, HEARTBEAT_INTERVAL_MS\)/)
  assert.match(workers, /clearInterval\(heartbeatTimer\)/)
  assert.match(workers, /completeJob\(jobId, \(result \?\? \{\}\) as Record<string, unknown>, attempt\)/)
  assert.match(workers, /failJob\(jobId, err instanceof Error \? err.message : String\(err\), attempt\)/)
})

test('worker and import-job reads fail closed when observability migration is missing', () => {
  const worker = read('worker/index.ts')
  const service = read('src/lib/import-export/jobs/import-job.service.ts')
  const compatibility = read('src/lib/platform/schema-compatibility.ts')

  assert.match(worker, /await assertImportJobSchemaCompatibility\(\)/)
  assert.match(service, /await assertImportJobSchemaCompatibility\(\)/)
  assert.match(compatibility, /REQUIRED_IMPORT_JOB_SCHEMA_VERSION = '063_import_job_observability'/)
  assert.match(compatibility, /progress_snapshot,activity_events/)
  assert.match(compatibility, /Apply supabase\/migrations\/063_import_job_observability\.sql/)
})
