import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { OwnershipLostError, isOwnershipLostError } from '../../src/lib/platform/jobs/ownership-error'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('ownership lost errors are detectable for abandoned workers', () => {
  const error = new OwnershipLostError('queue-1', 2)
  assert.equal(error.name, 'OwnershipLostError')
  assert.equal(error.platformJobId, 'queue-1')
  assert.equal(error.attempt, 2)
  assert.equal(isOwnershipLostError(error), true)
  assert.equal(isOwnershipLostError(new Error('other')), false)
})

test('heartbeat timeout marks ownership lost and aborts the handler lease', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const ownership = read('src/lib/platform/jobs/ownership.ts')
  const queue = read('src/lib/platform/jobs/queue.ts')

  assert.match(ownership, /createJobOwnership/)
  assert.match(ownership, /verifyJobOwnership/)
  assert.match(ownership, /eq\('attempts', attempt\)|Number\(data\.attempts\) === attempt/)
  assert.match(ownership, /status === 'RUNNING'|String\(data\.status\) === 'RUNNING'/)
  assert.match(workers, /ownership\.markLost\('heartbeat_rejected'\)/)
  assert.match(workers, /await heartbeat\(\)/)
  assert.match(workers, /setInterval\(\(\) => \{ void heartbeat\(\) \}, HEARTBEAT_INTERVAL_MS\)/)
  assert.match(queue, /eq\('attempts', attempt\)/)
  assert.match(queue, /Recovered abandoned RUNNING job after heartbeat timeout/)
})

test('stale recovery increments attempts so reclaimed workers cannot share a lease', () => {
  const queue = read('src/lib/platform/jobs/queue.ts')
  const ownership = read('src/lib/platform/jobs/ownership.ts')

  assert.match(queue, /status: 'PENDING', started_at: null, scheduled_at: now, updated_at: now/)
  assert.match(queue, /attempts: Number\(job\.attempts\) \+ 1/)
  assert.match(ownership, /Number\(data\.attempts\) === attempt/)
  assert.match(ownership, /OwnershipLostError/)
})

test('ownership loss stops progress, snapshots, counters, and finalization', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  const processor = read('src/lib/import-export/import/import-processor.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')
  const ownershipLostBranchStart = route.indexOf('if (isOwnershipLostError(error))')
  const ownershipLostBranchEnd = route.indexOf('const normalized=normalizeImportError(error)', ownershipLostBranchStart)
  const ownershipLostBranch = route.slice(ownershipLostBranchStart, ownershipLostBranchEnd)

  assert.ok(ownershipLostBranchStart >= 0)
  assert.ok(ownershipLostBranchEnd > ownershipLostBranchStart)
  assert.match(ownershipLostBranch, /quickbooks\.import_job\.abandoned_after_ownership_loss/)
  assert.match(ownershipLostBranch, /throw error/)
  assert.doesNotMatch(ownershipLostBranch, /finalizeImportJob/)
  assert.match(route, /assertActive: ensureOwned/)
  assert.match(route, /await ensureOwned\(\)/)
  assert.match(route, /reason: 'ownership_lost'/)
  assert.match(processor, /if \(input\.assertActive\) await input\.assertActive\(\)/)
  assert.match(workers, /abandoned_after_ownership_loss/)
  assert.match(workers, /if \(isOwnershipLostError\(err\) \|\| ownership\.isLost\(\)\)/)
})

test('reclaimed queue jobs and container restarts cannot complete under the old attempt', () => {
  const queue = read('src/lib/platform/jobs/queue.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')

  assert.match(queue, /completeJob[\s\S]*eq\('status', 'RUNNING'\)\.eq\('attempts', attempt\)/)
  assert.match(queue, /failJob[\s\S]*eq\('status', 'RUNNING'\)\.eq\('attempts', attempt\)/)
  assert.match(queue, /updateJobProgress[\s\S]*eq\('attempts', attempt\)/)
  assert.match(workers, /await completeJob\(jobId, \(result \?\? \{\}\) as Record<string, unknown>, attempt\)/)
  assert.match(workers, /await ownership\.assertOwned\(\)/)
  assert.match(workers, /createJobOwnership\(jobId, attempt\)/)
})

test('continuation jobs still require ownership before dispatch and completion', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const route = read('src/app/api/import-export/[module]/import/route.ts')

  assert.match(workers, /runImportJobStep\(importJobId, companyId, userId, ownership\)/)
  assert.match(workers, /QUICKBOOKS_IMPORT_STEP[\s\S]*await ownership\.assertOwned\(\)/)
  assert.match(route, /enqueueJob\(\{[\s\S]*jobType: 'QUICKBOOKS_IMPORT_STEP'/)
  assert.match(route, /if \(sourcePage\?\.hasMore\)[\s\S]*await ensureOwned\(\)/)
  assert.match(route, /export async function runImportJobStep\(jobId: string, companyId: string, userId: string, ownership\?: JobOwnership\)/)
})

test('duplicate execution is prevented by attempt-scoped leases across crash and restart paths', () => {
  const workers = read('src/lib/platform/jobs/workers.ts')
  const ownership = read('src/lib/platform/jobs/ownership.ts')
  const queue = read('src/lib/platform/jobs/queue.ts')

  // Crash / restart: stale RUNNING -> PENDING, then claim increments attempts.
  assert.match(queue, /lt\('updated_at', stale\)/)
  assert.match(queue, /attempts: Number\(job\.attempts\) \+ 1/)
  // Old worker heartbeat/complete/fail/progress all require the original attempt.
  assert.match(ownership, /markLost/)
  assert.match(workers, /ownership\.markLost\('heartbeat_rejected'\)/)
  assert.match(workers, /ownership\.markLost\('heartbeat_error'\)/)
  assert.match(queue, /heartbeatJob[\s\S]*eq\('attempts', attempt\)/)
  // Import mutation path refuses to continue once the lease is gone.
  assert.match(workers, /await ownership\.assertOwned\(\)/)
  assert.match(read('src/app/api/import-export/[module]/import/route.ts'), /assertActive: ensureOwned/)
})
