/**
 * listAttachmentLedger MUST return the COMPLETE ledger regardless of size —
 * PostgREST caps a single response at 1000 rows, and the original unbounded
 * query silently truncated (root cause of the Snapshot #2 over-capture).
 *
 * Run: npm run test:quickbooks-snapshot
 */
import { test, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createFakeSupabase, POSTGREST_MAX_ROWS } from './fake-supabase'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const MOCKS: string | false =
  typeof (mock as { module?: unknown }).module === 'function'
    ? false
    : 'requires: npx tsx --test --experimental-test-module-mocks'

let fake: ReturnType<typeof createFakeSupabase>
let mod: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-ledger')

before(async () => {
  if (MOCKS) return
  fake = createFakeSupabase()
  mock.module('server-only', { namedExports: {}, defaultExport: {} })
  mock.module('@/lib/supabase/admin', { namedExports: { createAdminClient: () => fake.client } })
  mod = await import('../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-ledger')
})
after(() => mock.restoreAll())

function seedLedger(snapshotId: string, n: number, capturedEvery = 7) {
  const rows = fake.db.get('quickbooks_snapshot_attachments') ?? []
  fake.db.set('quickbooks_snapshot_attachments', rows)
  for (let i = 0; i < n; i += 1) {
    rows.push({
      snapshot_id: snapshotId,
      company_id: 'c1',
      // zero-padded so string ordering == numeric ordering
      attachable_id: `att-${String(i).padStart(7, '0')}`,
      status: i % capturedEvery === 0 ? 'captured' : 'skipped_budget',
      captured_bytes: i % capturedEvery === 0 ? 1000 + i : null,
      storage_path: i % capturedEvery === 0 ? `attachments/att-${i}/f.pdf` : null,
      file_name: 'f.pdf', content_type: 'application/pdf', source_size: 1000 + i,
      reason: null, checksum: i % capturedEvery === 0 ? 'deadbeef' : null, entity_ref: null,
    })
  }
}

for (const n of [1, 999, 1000, 1001, 2000, 8176, 10001]) {
  test(`listAttachmentLedger returns ALL ${n} rows (PostgREST cap is ${POSTGREST_MAX_ROWS})`, { skip: MOCKS }, async () => {
    const snap = `snap-${n}`
    seedLedger(snap, n)

    const all = await mod.listAttachmentLedger(snap)
    assert.equal(all.length, n, `expected ${n}, got ${all.length}`)

    // ordering preserved
    for (let i = 1; i < all.length; i += 1) {
      assert.ok(all[i - 1].attachableId < all[i].attachableId, 'rows are ordered by attachable_id')
    }
    // no duplicates across page boundaries
    assert.equal(new Set(all.map((e) => e.attachableId)).size, n)

    // count helper agrees
    assert.equal(await mod.countAttachmentLedger(snap), n)

    // captured accounting is complete (would be wrong if truncated at 1000)
    const expectedCaptured = Math.ceil(n / 7)
    assert.equal(all.filter((e) => e.status === 'captured').length, expectedCaptured)
    assert.equal(mod.summariseAttachmentLedger(all).captured, expectedCaptured)
  })
}

test('a count/rows mismatch throws — never silently truncates', { skip: MOCKS }, async () => {
  const snap = 'snap-anom'
  seedLedger(snap, 2500)
  fake.countDelta['quickbooks_snapshot_attachments'] = 5 // count over-reports
  try {
    await assert.rejects(() => mod.listAttachmentLedger(snap), /pagination anomaly/)
  } finally {
    delete fake.countDelta['quickbooks_snapshot_attachments']
  }
  // and it succeeds once the anomaly clears
  assert.equal((await mod.listAttachmentLedger(snap)).length, 2500)
})
