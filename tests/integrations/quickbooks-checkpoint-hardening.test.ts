import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { resolveSourcePageHasMore } from '../../src/lib/import-export/sources/source-page-state'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

// ---------------------------------------------------------------------------
// Checkpoint contract — adapter pagination guarantees
// ---------------------------------------------------------------------------

// The non-partitioned page runner reports hasMore purely from page fullness.
// This is the guarantee the continuation chain relies on: an empty page can
// never claim there is more to fetch.
test('non-partitioned extraction: an empty/short page can never report hasMore=true', () => {
  const provider = read('src/integrations/accounting/providers/quickbooks/quickbooks-integration.service.ts')
  // The literal formula the migration depends on.
  assert.match(provider, /const pageHasMore = page\.length >= pageSize && fetchedCount < maxRecords/)

  // Replicate it: hasMore requires a full page (>= pageSize), so 0 rows => false.
  const pageHasMore = (pageLength: number, pageSize: number, fetched: number, maxRecords: number) =>
    pageLength >= pageSize && fetched < maxRecords
  assert.equal(pageHasMore(0, 100, 0, Number.POSITIVE_INFINITY), false)
  assert.equal(pageHasMore(40, 100, 40, Number.POSITIVE_INFINITY), false)
  assert.equal(pageHasMore(100, 100, 100, Number.POSITIVE_INFINITY), true)
})

// The provider also refuses to repeat or stall a page within a single fetch.
test('provider rejects a non-advancing or repeated page inside one fetch', () => {
  const provider = read('src/integrations/accounting/providers/quickbooks/quickbooks-integration.service.ts')
  assert.match(provider, /QuickBooks pagination did not advance for \$\{entity\}/)
  assert.match(provider, /QuickBooks pagination repeated a page for \$\{entity\}/)
})

// Date-partitioned extraction (transactions) DOES emit an empty page with a
// "there is another window" signal, but it always advances partition_start and
// terminates once the window reaches `last`.
test('partitioned extraction advances the date window and terminates at last', () => {
  const provider = read('src/integrations/accounting/providers/quickbooks/quickbooks-integration.service.ts')
  assert.match(provider, /const partitionComplete = Boolean\(partitionStart && page\.length < pageSize\)/)
  assert.match(provider, /const hasMore = end < last/)
  assert.match(provider, /partitionStart: end\.toISOString\(\)/, 'next window starts where this one ended')

  // 10-year windows, capped at `last` — strictly increasing, so the scan is bounded.
  const nextEnd = (startYear: number, lastMs: number) =>
    Math.min(Date.UTC(startYear + 10, 0, 1), lastMs)
  const lastMs = Date.UTC(2027, 0, 1)
  let start = Date.UTC(2010, 0, 1)
  let steps = 0
  while (start < lastMs && steps < 50) {
    const end = nextEnd(new Date(start).getUTCFullYear(), lastMs)
    assert.ok(end > start, 'the window must move forward every step')
    start = end
    steps += 1
  }
  assert.ok(steps <= 3, 'a realistic company needs at most a couple of window steps')
})

// ---------------------------------------------------------------------------
// resolveSourcePageHasMore — the adapter result is authoritative
// ---------------------------------------------------------------------------

test('resolveSourcePageHasMore always defers to a concrete adapter boolean', () => {
  // Empty non-paginated resource: optimistic true, adapter says false => terminal.
  assert.equal(resolveSourcePageHasMore(true, false), false)
  // Provider callback observed more, resource object omitted the flag => keep observed.
  assert.equal(resolveSourcePageHasMore(true, undefined), true)
  assert.equal(resolveSourcePageHasMore(false, undefined), false)
})

// ---------------------------------------------------------------------------
// Stall guard — the orchestration-level circuit breaker (Phase 3)
// ---------------------------------------------------------------------------

test('fetchSourceResourcePage stops a resumed page that advances no cursor', () => {
  const registry = read('src/lib/import-export/sources/source-registry.ts')
  const guardStart = registry.indexOf('Defense in depth against an unbounded continuation chain')
  assert.ok(guardStart >= 0, 'the stall guard is present')
  const guard = registry.slice(guardStart, registry.indexOf('return {', guardStart))

  // Only runs for a resumed page — a first page is allowed to be legitimately empty.
  assert.match(guard, /if \(hasMore && resumable && prior\)/)
  // "Advanced" if cumulative count grew, STARTPOSITION moved, OR the partition window moved.
  assert.match(guard, /Number\(pageCheckpoint\.fetched\) > Number\(prior\.extracted_count \?\? 0\)/)
  assert.match(guard, /Number\(pageCheckpoint\.startPosition\) !== Number\(prior\.next_start_position \?\? 1\)/)
  assert.match(guard, /priorPartitionMs !== nextPartitionMs/)
  // On a genuine stall it terminates the chain and leaves a warning.
  assert.match(guard, /quickbooks\.migration\.checkpoint\.stall_detected/)
  assert.match(guard, /hasMore = false/)
})

// Replicate the guard's decision to prove it ignores valid progress and only
// trips on a frozen cursor.
test('stall guard: cursorAdvanced logic ignores valid progress, trips only on a freeze', () => {
  const advanced = (prior: { extracted_count: number; next_start_position: number; partition_start: string | null },
    next: { fetched: number; startPosition: number; partitionStart: string | null }) => {
    const priorPartitionMs = prior.partition_start ? Date.parse(prior.partition_start) : null
    const nextPartitionMs = next.partitionStart ? Date.parse(next.partitionStart) : null
    return Number(next.fetched) > Number(prior.extracted_count ?? 0)
      || Number(next.startPosition) !== Number(prior.next_start_position ?? 1)
      || priorPartitionMs !== nextPartitionMs
  }

  // Non-partitioned page that imported 100 more rows.
  assert.equal(advanced(
    { extracted_count: 100, next_start_position: 101, partition_start: null },
    { fetched: 200, startPosition: 201, partitionStart: null },
  ), true)

  // Empty date-partition window — count frozen, but the window moved forward.
  assert.equal(advanced(
    { extracted_count: 500, next_start_position: 1, partition_start: '2015-01-01T00:00:00.000Z' },
    { fetched: 500, startPosition: 1, partitionStart: '2025-01-01T00:00:00.000Z' },
  ), true)

  // Frozen cursor: nothing moved at all -> NOT advanced -> guard trips.
  assert.equal(advanced(
    { extracted_count: 300, next_start_position: 1, partition_start: '2025-01-01T00:00:00.000Z' },
    { fetched: 300, startPosition: 1, partitionStart: '2025-01-01T00:00:00.000Z' },
  ), false)
})

// ---------------------------------------------------------------------------
// Checkpoint durability ordering (Phase 2 invariant preserved)
// ---------------------------------------------------------------------------

test('a continuation is only scheduled after the checkpoint AND the queue row are durable', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  const workers = read('src/lib/platform/jobs/workers.ts')

  // Inside the hasMore branch: commit() runs before the response is returned.
  const branchStart = route.indexOf('if (sourcePage?.hasMore)')
  const branchEnd = route.indexOf('if (sourcePage) await sourcePage.commit()', branchStart)
  const branch = route.slice(branchStart, branchEnd)
  assert.ok(branch.indexOf('await sourcePage.commit()') >= 0)
  assert.ok(branch.indexOf('await sourcePage.commit()') < branch.indexOf("status: 'processing'"))

  // In the worker: completeJob (queue row COMPLETED) precedes the continuation hook.
  assert.ok(
    workers.indexOf('await completeJob(jobId, (result ?? {}) as Record<string, unknown>, attempt)')
    < workers.indexOf('await postComplete(payload, jobId, result)'),
  )
  // And the hook only reschedules a step that reported more work.
  const hook = workers.slice(
    workers.indexOf("registerPostCompleteHook('QUICKBOOKS_IMPORT_STEP'"),
    workers.indexOf("registerJobHandler('AUTOMATION_RUN'"),
  )
  assert.match(hook, /status !== 'processing'/)
})

// ---------------------------------------------------------------------------
// Retry / resume from the durable checkpoint
// ---------------------------------------------------------------------------

test('a resumed page reads its start position and partition from the persisted checkpoint', () => {
  const registry = read('src/lib/import-export/sources/source-registry.ts')
  assert.match(registry, /const resumable = \['running', 'failed'\]\.includes\(String\(prior\?\.status\)\)/)
  assert.match(registry, /startPosition: resumable \? Number\(prior\?\.next_start_position \?\? 1\) : 1/)
  assert.match(registry, /const priorFetched = resumable \? Number\(prior\?\.extracted_count \?\? 0\) : 0/)
  // Only a non-resumable start clears staging — a resume must not drop staged rows.
  assert.match(registry, /if \(!resumable\) await clearQuickBooksStaging/)
  // The checkpoint is upserted (idempotent) keyed by the resource.
  assert.match(registry, /onConflict: 'company_id,realm_id,resource_key'/)
})

// ---------------------------------------------------------------------------
// recoverOrphanedContinuations guard is unchanged
// ---------------------------------------------------------------------------

test('recovery still requires a committed, incomplete, stale-heartbeat job', () => {
  const scheduler = read('src/lib/platform/continuation-scheduler.ts')
  assert.match(scheduler, /Number\(row\.processed_rows\) > 0/)
  assert.match(scheduler, /total > 0 && processed < total/)
  assert.match(scheduler, /\.lt\('last_heartbeat_at', cutoff\)/)
  assert.match(scheduler, /in\('status', \['PENDING','RUNNING'\]\)/)
})
