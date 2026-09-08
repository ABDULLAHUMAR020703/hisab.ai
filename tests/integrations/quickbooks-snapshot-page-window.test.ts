/**
 * Snapshot-backed migration read WINDOWING.
 *
 * Regression for the confirmed data-loss bug: a snapshot Storage page file holds
 * up to 1000 raw records, but the importer processes one bounded 100-record
 * batch per worker invocation. The reader used to derive `hasMore` purely from
 * page-file count, so a 481-record page file was treated as exhausted after the
 * first 100-record batch and the module was marked complete with 381 records
 * silently dropped (accounts 481 -> 100, vendors 588 -> 100 in production).
 *
 * `fetchSnapshotResourcePage` now returns the window
 * [pageOffset, pageOffset+100) and only advances the page-file cursor once the
 * whole page file is consumed.
 *
 * Run: npm run test:quickbooks-snapshot
 */
import { test, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MOCKS: string | false =
  typeof (mock as { module?: unknown }).module === 'function' ? false : 'requires --experimental-test-module-mocks'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://snapshot-window-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-test'

const REALM = '9130356995984366'
const PREFIX = 'co/quickbooks/9130356995984366/snapshots/snap-1'
const SNAP = 'snap-1'
const COMPANY = 'co-1'

/** In-memory stand-ins for the four sibling modules the reader depends on. */
const store = {
  pages: new Map<string, unknown[]>(), // "accounts/page-000001.json" -> raw records
  cursors: new Map<string, Record<string, unknown>>(), // `${jobId}:${resource}` -> row
  ledger: [] as Array<Record<string, unknown>>,
  reset() {
    this.pages.clear()
    this.cursors.clear()
    this.ledger = []
  },
}

let fetchSnapshotResourcePage: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-source')['fetchSnapshotResourcePage']

before(async () => {
  if (MOCKS) return
  mock.module('server-only', { namedExports: {}, defaultExport: {} })
  mock.module('../../src/lib/import-export/quickbooks/snapshot/snapshot.service', {
    namedExports: {
      getSnapshot: async () => ({
        id: SNAP,
        status: 'COMPLETE',
        validation: { ok: true },
        storagePrefix: PREFIX,
        realmId: REALM,
      }),
      getReadCursor: async (importJobId: string, resourceKey: string) =>
        store.cursors.get(`${importJobId}:${resourceKey}`) ?? null,
      upsertReadCursor: async (input: Record<string, unknown>) => {
        store.cursors.set(`${input.importJobId}:${input.resourceKey}`, {
          importJobId: input.importJobId,
          companyId: input.companyId,
          snapshotId: input.snapshotId,
          resourceKey: input.resourceKey,
          nextPage: input.nextPage,
          pageOffset: input.pageOffset,
          recordsRead: input.recordsRead,
          exhausted: input.exhausted,
        })
      },
    },
  })
  mock.module('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage', {
    namedExports: {
      readRawPage: async (_prefix: string, file: string) => store.pages.get(file) ?? [],
    },
  })
  mock.module('../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-ledger', {
    namedExports: {
      listAttachmentLedger: async () => store.ledger,
    },
  })
  // Manifest is computed from `store` at call time so each test's seeded pages
  // are reflected.
  mock.module('../../src/lib/import-export/quickbooks/snapshot/snapshot-manifest', {
    namedExports: {
      readSnapshotManifest: async () => {
        // union of every resource's files
        const entities: Record<string, unknown> = {}
        for (const key of new Set([...store.pages.keys()].map((f) => f.split('/')[0]))) {
          entities[key] = { resourceKey: key, files: [...store.pages.keys()].filter((f) => f.startsWith(`${key}/`)).sort() }
        }
        return { entities }
      },
      buildSnapshotManifest: async () => ({ entities: {} }),
    },
  })
  ;({ fetchSnapshotResourcePage } = await import(
    '../../src/lib/import-export/quickbooks/snapshot/snapshot-source'
  ))
})
after(() => mock.restoreAll())

function seedPage(resourceKey: string, page: number, entity: string, count: number, startId = 1) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = String(startId + i)
    if (entity === 'Account') return { Id: id, Name: `Account ${id}`, AcctNum: `AC-${id}`, AccountType: 'Bank', Active: true }
    if (entity === 'Vendor') return { Id: id, DisplayName: `Vendor ${id}`, Active: true, Job: false }
    return { Id: id, DocNumber: id, TxnDate: '2024-01-01', TotalAmt: 1, CustomerRef: { value: '1' }, Line: [] }
  })
  store.pages.set(`${resourceKey}/page-${String(page).padStart(6, '0')}.json`, rows)
}

/** Drives the route's continuation loop: fetch -> collect -> commit until done. */
async function consume(resourceKey: string, jobId = 'job-1') {
  const seenIds: string[] = []
  const order: string[] = []
  let invocations = 0
  let firstHasMore: boolean | undefined
  let lastFetched = 0
  for (let guard = 0; guard < 10_000; guard += 1) {
    const page = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey, importJobId: jobId })
    invocations += 1
    if (firstHasMore === undefined) firstHasMore = page.hasMore
    for (const row of page.resource.rows) {
      const id = String((row as Record<string, unknown>)._quickbooksId ?? (row as Record<string, unknown>).accountNo ?? '')
      seenIds.push(id)
      order.push(id)
    }
    assert.ok(page.checkpoint.fetched >= lastFetched, 'checkpoint.fetched must be monotonic')
    lastFetched = page.checkpoint.fetched
    await page.commit()
    if (!page.hasMore) break
  }
  return { seenIds, order, invocations, firstHasMore, fetched: lastFetched }
}

const RESOURCE = 'invoices'
const ENTITY = 'Invoice'

for (const count of [0, 1, 99, 100, 101, 481, 588, 1000]) {
  test(`consumes every record exactly once for a single ${count}-record page file`, { skip: MOCKS }, async () => {
    store.reset()
    if (count > 0) seedPage(RESOURCE, 1, ENTITY, count)
    else store.pages.set(`${RESOURCE}/page-000001.json`, [])
    const r = await consume(RESOURCE)
    assert.equal(r.seenIds.length, count, `expected ${count} records consumed`)
    assert.equal(new Set(r.seenIds).size, count, 'no duplicates')
    assert.equal(r.fetched, count, 'final checkpoint.fetched equals the record count')
    if (count > 0) {
      const expected = Array.from({ length: count }, (_, i) => String(i + 1))
      assert.deepEqual([...r.seenIds].sort((a, b) => Number(a) - Number(b)), expected)
    }
  })
}

test('481-record page file cannot complete after only the first 100 (accounts regression)', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('accounts', 1, 'Account', 481)
  const first = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'accounts', importJobId: 'job-acc' })
  assert.equal(first.resource.rows.length, 100)
  assert.equal(first.hasMore, true, 'a 481-record page file must report more work after the first 100')
  await first.commit()
  const r = await consume('accounts', 'job-acc')
  // consume() re-enters from the committed cursor; total across both = 481.
  assert.equal(100 + r.seenIds.length, 481)
  assert.equal(r.invocations, 4, 'remaining 381 records take four more 100-windows (100/100/100/81)')
})

test('588-record page file consumes all 588 (vendors regression)', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('vendors', 1, 'Vendor', 588)
  const r = await consume('vendors', 'job-vend')
  assert.equal(r.seenIds.length, 588)
  assert.equal(new Set(r.seenIds).size, 588)
  assert.equal(r.invocations, 6, '588 -> six windows (100*5 + 88)')
})

test('multi-page: 2283 records across 3 page files consume every record once, page cursor advances only when a file is done', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('journal-entries', 1, 'JournalEntry', 1000, 1)
  seedPage('journal-entries', 2, 'JournalEntry', 1000, 1001)
  seedPage('journal-entries', 3, 'JournalEntry', 283, 2001)
  const r = await consume('journal-entries', 'job-je')
  assert.equal(r.seenIds.length, 2283)
  assert.equal(new Set(r.seenIds).size, 2283)
  assert.equal(r.fetched, 2283)
  // 10 + 10 + 3 windows
  assert.equal(r.invocations, 23)
})

test('exact page boundary: two full 1000-record page files', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('invoices', 1, 'Invoice', 1000, 1)
  seedPage('invoices', 2, 'Invoice', 1000, 1001)
  const r = await consume('invoices', 'job-bnd')
  assert.equal(r.seenIds.length, 2000)
  assert.equal(new Set(r.seenIds).size, 2000)
})

test('partial final page: 1000 + 37', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('invoices', 1, 'Invoice', 1000, 1)
  seedPage('invoices', 2, 'Invoice', 37, 1001)
  const r = await consume('invoices', 'job-part')
  assert.equal(r.seenIds.length, 1037)
  assert.equal(new Set(r.seenIds).size, 1037)
})

test('crash between windows (no commit) re-serves the same window; no record lost or doubled after resume', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('invoices', 1, 'Invoice', 250)
  const a = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-crash' })
  const idsA = a.resource.rows.map((r) => String((r as Record<string, unknown>)._quickbooksId))
  await a.commit()
  // window 2 fetched but the worker dies before commit()
  const b1 = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-crash' })
  const idsB1 = b1.resource.rows.map((r) => String((r as Record<string, unknown>)._quickbooksId))
  // resume: same window again
  const b2 = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-crash' })
  const idsB2 = b2.resource.rows.map((r) => String((r as Record<string, unknown>)._quickbooksId))
  assert.deepEqual(idsB1, idsB2, 'an uncommitted window is served identically on the retry')
  await b2.commit()
  const rest = await consume('invoices', 'job-crash')
  const all = [...idsA, ...idsB2, ...rest.seenIds]
  assert.equal(all.length, 250)
  assert.equal(new Set(all).size, 250)
})

test('crash after the final window but before page advancement: replays the tail window, then exhausts cleanly', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('invoices', 1, 'Invoice', 150)
  const w1 = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-tail' })
  await w1.commit()
  const tail = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-tail' })
  assert.equal(tail.resource.rows.length, 50)
  assert.equal(tail.hasMore, false)
  // crash before commit -> retry serves the same 50
  const tailRetry = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-tail' })
  assert.equal(tailRetry.resource.rows.length, 50)
  await tailRetry.commit()
  const after = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-tail' })
  assert.equal(after.resource.rows.length, 0)
  assert.equal(after.hasMore, false)
})

test('replay after exhaustion is an empty no-op', { skip: MOCKS }, async () => {
  store.reset()
  seedPage('invoices', 1, 'Invoice', 40)
  await consume('invoices', 'job-done')
  const again = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'invoices', importJobId: 'job-done' })
  assert.equal(again.resource.rows.length, 0)
  assert.equal(again.hasMore, false)
})

test('accounts: a parent in a later raw position than its child still precedes the child in the consumed stream', { skip: MOCKS }, async () => {
  store.reset()
  // 150 accounts; account "P" at raw index 120 is the parent of account "C" at raw index 5.
  const rows = Array.from({ length: 150 }, (_, i) => ({
    Id: String(i + 1), Name: `A${i + 1}`, AcctNum: `AC-${i + 1}`, AccountType: 'Bank', Active: true,
  })) as Array<Record<string, unknown>>
  rows[5].ParentRef = { value: '121' } // child C (Id 6) -> parent P (Id 121)
  store.pages.set('accounts/page-000001.json', rows)
  const r = await consume('accounts', 'job-hier')
  assert.equal(r.order.length, 150)
  const parentPos = r.order.findIndex((id) => id === '121' || id === 'AC-121')
  const childPos = r.order.findIndex((id) => id === '6' || id === 'AC-6')
  assert.ok(parentPos !== -1 && childPos !== -1, `parent/child present: ${parentPos}/${childPos}`)
  assert.ok(parentPos < childPos, `parent (pos ${parentPos}) must precede child (pos ${childPos}) across the window boundary`)
})

test('attachments: window slicing keeps _hisabAttachment aligned to captured ledger rows only', { skip: MOCKS }, async () => {
  store.reset()
  const raw = Array.from({ length: 130 }, (_, i) => ({
    Id: String(i + 1),
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: '1' } }],
    FileName: `f${i + 1}.pdf`,
  }))
  store.pages.set('attachments/page-000001.json', raw)
  // only ids 3 and 118 are "captured" — one in window 1, one in window 2.
  store.ledger = [
    { attachableId: '3', status: 'captured', storagePath: 'attachments/3/f3.pdf', fileName: 'f3.pdf', contentType: 'application/pdf' },
    { attachableId: '118', status: 'captured', storagePath: 'attachments/118/f118.pdf', fileName: 'f118.pdf', contentType: 'application/pdf' },
  ]
  let withBinary = 0
  let total = 0
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId: SNAP, resourceKey: 'attachments', importJobId: 'job-att' })
    for (const row of page.resource.rows) {
      total += 1
      if ((row as Record<string, unknown>)._hisabAttachment) withBinary += 1
    }
    await page.commit()
    if (!page.hasMore) break
  }
  assert.equal(total, 130, 'every attachable metadata row is still yielded')
  assert.equal(withBinary, 2, 'exactly the two captured attachables carry _hisabAttachment, across the window boundary')
})

test('migration 071 adds page_offset to the read cursor', { skip: MOCKS }, () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/071_quickbooks_snapshot_read_cursor_page_offset.sql'),
    'utf8',
  )
  assert.match(sql, /ALTER TABLE public\.quickbooks_snapshot_read_cursors\s+ADD COLUMN IF NOT EXISTS page_offset INT NOT NULL DEFAULT 0/)
})
