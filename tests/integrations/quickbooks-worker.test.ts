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
