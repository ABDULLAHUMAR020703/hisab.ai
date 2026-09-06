/**
 * End-to-end snapshot lifecycle on faithful in-memory Supabase (DB + Storage)
 * and a real QuickBooksIntegrationService backed by a fake fetch:
 *
 *   createSnapshot -> orchestrator steps (worker continuation) -> pages in Storage
 *   -> checkpoints advance -> validation -> snapshot COMPLETE
 *   -> snapshot-backed migration read via fetchSnapshotResourcePage
 *   -> QuickBooks provider is never touched during the migration read (asserted)
 *   -> re-run the migration read: still zero QuickBooks calls
 *
 * Run: npx tsx --test --experimental-test-module-mocks tests/integrations/quickbooks-snapshot-lifecycle.test.ts
 */
import { test, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createFakeSupabase } from './fake-supabase'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

process.env.QB_SNAPSHOT_PAGES_PER_STEP = '1'

// This suite drives the assembled path over an in-memory Supabase and needs the
// module-mock loader. Run: npm run test:quickbooks-snapshot
const MOCKS: string | false =
  typeof (mock as { module?: unknown }).module === 'function'
    ? false
    : 'requires: npx tsx --test --experimental-test-module-mocks'

const CONFIG = { clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/cb', environment: 'sandbox' as const, additionalScopes: [] }
const CONTEXT = { accessToken: 'token', realmId: '4600' }
const NOW = () => new Date('2026-01-01T00:00:00.000Z')
const COMPANY = 'company-1'
const USER = 'user-1'

const ACCOUNTS = [
  { Id: 'a1', Name: 'Cash', AcctNum: '1000', AccountType: 'Bank', Active: true },
  { Id: 'a2', Name: 'AR', AcctNum: '1100', AccountType: 'Accounts Receivable', Active: true },
]
const CUSTOMERS = [
  { Id: 'c1', DisplayName: 'Acme', PrimaryEmailAddr: { Address: 'a@acme.test' }, Active: true, Job: false },
  { Id: 'c2', DisplayName: 'Globex', Active: true, Job: false },
]
// Invoices across three provider windows from earliest 2003-06-01.
const INVOICES = [
  { Id: 'i1', DocNumber: 'INV-1', TxnDate: '2003-06-01', TotalAmt: 100, CustomerRef: { value: 'c1' }, Line: [] },
  { Id: 'i2', DocNumber: 'INV-2', TxnDate: '2015-04-04', TotalAmt: 200, CustomerRef: { value: 'c2' }, Line: [] },
  { Id: 'i3', DocNumber: 'INV-3', TxnDate: '2024-09-09', TotalAmt: 300, CustomerRef: { value: 'c1' }, Line: [] },
]

function fakeFetch(counter: { qb: number }): typeof fetch {
  return (async (input: string | URL): Promise<Response> => {
    counter.qb += 1
    const url = String(input)
    const query = new URL(url).searchParams.get('query') ?? ''
    const entity = /FROM (\w+)/.exec(query)?.[1] ?? ''
    const pos = Number(/STARTPOSITION (\d+)/.exec(query)?.[1] ?? '1')
    const max = Number(/MAXRESULTS (\d+)/.exec(query)?.[1] ?? '1000')

    if (/ORDERBY TxnDate ASC/.test(query) && /MAXRESULTS 1/.test(query)) {
      return json({ QueryResponse: { [entity]: [INVOICES[0]], startPosition: 1, maxResults: 1 } })
    }
    const source: Record<string, Array<Record<string, unknown>>> = { Account: ACCOUNTS, Customer: CUSTOMERS, Invoice: INVOICES }
    let rows = source[entity] ?? []
    const range = /TxnDate >= '([\d-]+)' AND TxnDate < '([\d-]+)'/.exec(query)
    if (range) rows = rows.filter((r) => String(r.TxnDate) >= range[1] && String(r.TxnDate) < range[2])
    return json({ QueryResponse: { [entity]: rows.slice(pos - 1, pos - 1 + max), startPosition: pos, maxResults: max } })
  }) as unknown as typeof fetch
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

let fake: ReturnType<typeof createFakeSupabase>
let mod: {
  createSnapshot: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')['createSnapshot']
  getSnapshot: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')['getSnapshot']
  listCheckpoints: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')['listCheckpoints']
  runSnapshotOrchestratorStep: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator')['runSnapshotOrchestratorStep']
  fetchSnapshotResourcePage: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-source')['fetchSnapshotResourcePage']
  QuickBooksIntegrationService: typeof import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service')['QuickBooksIntegrationService']
  QuickBooksImportAdapter: typeof import('../../src/lib/import-export/sources/quickbooks.adapter')['QuickBooksImportAdapter']
  filterResourceRows: typeof import('../../src/lib/import-export/sources/quickbooks.adapter')['filterResourceRows']
  listObjects: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage')['listObjects']
}

before(async () => {
  if (MOCKS) return
  fake = createFakeSupabase()
  // The module-mock loader bypasses the Module._load `server-only` shim, so stub it here too.
  mock.module('server-only', { namedExports: {}, defaultExport: {} })
  mock.module('@/lib/supabase/admin', {
    namedExports: { createAdminClient: () => fake.client },
  })
  const [service, orchestrator, source, provider, adapter, storage] = await Promise.all([
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-source'),
    import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'),
    import('../../src/lib/import-export/sources/quickbooks.adapter'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage'),
  ])
  mod = {
    createSnapshot: service.createSnapshot,
    getSnapshot: service.getSnapshot,
    listCheckpoints: service.listCheckpoints,
    runSnapshotOrchestratorStep: orchestrator.runSnapshotOrchestratorStep,
    fetchSnapshotResourcePage: source.fetchSnapshotResourcePage,
    QuickBooksIntegrationService: provider.QuickBooksIntegrationService,
    QuickBooksImportAdapter: adapter.QuickBooksImportAdapter,
    filterResourceRows: adapter.filterResourceRows,
    listObjects: storage.listObjects,
  }
})

after(() => mock.restoreAll())

test('full snapshot lifecycle reaches COMPLETE with pages in Storage and advanced checkpoints', { skip: MOCKS }, async (t) => {
  const qbCounter = { qb: 0 }
  const provider = new mod.QuickBooksIntegrationService(CONFIG, fakeFetch(qbCounter), NOW)

  const snapshot = await mod.createSnapshot({
    companyId: COMPANY,
    realmId: CONTEXT.realmId,
    userId: USER,
    requestedResources: ['accounts', 'customers', 'invoices'],
  })
  assert.equal(snapshot.status, 'RUNNING')

  // Worker continuation loop.
  let steps = 0
  for (; steps < 50; steps += 1) {
    const outcome = await mod.runSnapshotOrchestratorStep({
      provider: provider as never,
      context: CONTEXT,
      snapshotId: snapshot.id,
      companyId: COMPANY,
      userId: USER,
    })
    if (outcome.done) break
  }
  assert.ok(steps >= 4, `expected multi-step continuation, took ${steps + 1}`)

  const final = await mod.getSnapshot(snapshot.id, COMPANY)
  assert.equal(final?.status, 'COMPLETE', JSON.stringify(final?.validation?.issues ?? final))
  assert.equal(final?.validation?.ok, true)

  const checkpoints = await mod.listCheckpoints(snapshot.id)
  assert.deepEqual(
    checkpoints.map((c) => `${c.resourceKey}:${c.status}`).sort(),
    ['accounts:completed', 'customers:completed', 'invoices:completed'],
  )
  assert.equal(checkpoints.find((c) => c.resourceKey === 'invoices')!.recordsWritten, 3)
  // Invoices came through three contiguous partition windows.
  const parts = checkpoints.find((c) => c.resourceKey === 'invoices')!.partitions
  assert.equal(parts.length, 3)
  for (let i = 1; i < parts.length; i += 1) {
    assert.equal(parts[i - 1].end.slice(0, 10), parts[i].start.slice(0, 10))
  }

  // Storage holds the manifest + one page object per non-empty resource.
  const objects = await mod.listObjects(final!.storagePrefix)
  assert.ok(objects.includes('manifest.json'))
  assert.ok(objects.includes('accounts/page-000001.json'))
  assert.ok(objects.includes('customers/page-000001.json'))
  assert.ok(objects.some((o) => o.startsWith('invoices/page-')))

  t.diagnostic(`snapshot lifecycle: ${steps + 1} steps, ${qbCounter.qb} QuickBooks calls, status COMPLETE`)
  ;(globalThis as { __snapshotId?: string }).__snapshotId = snapshot.id
})

test('snapshot-backed migration reads every page from Storage and makes ZERO QuickBooks calls', { skip: MOCKS }, async (t) => {
  const snapshotId = (globalThis as { __snapshotId?: string }).__snapshotId!
  assert.ok(snapshotId, 'lifecycle test must run first')

  const realFetch = globalThis.fetch
  let qboCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('intuit.com')) qboCalls += 1
    return realFetch(input as never, init)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = realFetch
  })

  const adapter = new mod.QuickBooksImportAdapter()

  async function migrateResource(resourceKey: string, entity: string, raw: Array<Record<string, unknown>>) {
    const importJobId = `job-${resourceKey}-${Math.random().toString(36).slice(2)}`
    const collected: Record<string, string>[] = []
    let pages = 0
    for (let i = 0; i < 50; i += 1) {
      const page = await mod.fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId, resourceKey, importJobId })
      collected.push(...page.resource.rows)
      pages += 1
      await page.commit()
      if (!page.hasMore) break
    }
    // Equivalent to a live extraction of the same raw data.
    const live = adapter.normalizeRecords(resourceKey, mod.filterResourceRows(resourceKey, raw), CONTEXT.realmId)
    assert.deepEqual(collected, live, `${resourceKey}: snapshot-read rows must equal live-adapter rows`)
    return { pages, count: collected.length }
  }

  const accounts = await migrateResource('accounts', 'Account', ACCOUNTS)
  const customers = await migrateResource('customers', 'Customer', CUSTOMERS)
  const invoices = await migrateResource('invoices', 'Invoice', INVOICES)

  assert.equal(accounts.count, 2)
  assert.equal(customers.count, 2)
  assert.equal(invoices.count, 3)
  assert.ok(invoices.pages >= 3, 'invoices span multiple stored pages (one per partition window)')
  assert.equal(qboCalls, 0, 'ZERO QuickBooks HTTP calls during snapshot-backed migration')

  t.diagnostic(`migration read: ${accounts.pages + customers.pages + invoices.pages} pages, ${qboCalls} QuickBooks calls`)
})

test('re-running the migration against the same COMPLETE snapshot still makes ZERO QuickBooks calls', { skip: MOCKS }, async (t) => {
  const snapshotId = (globalThis as { __snapshotId?: string }).__snapshotId!
  const realFetch = globalThis.fetch
  let qboCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('intuit.com')) qboCalls += 1
    return realFetch(input as never, init)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = realFetch
  })

  const adapter = new mod.QuickBooksImportAdapter()
  const importJobId = `rerun-${Date.now()}`
  const collected: Record<string, string>[] = []
  for (let i = 0; i < 50; i += 1) {
    const page = await mod.fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId, resourceKey: 'invoices', importJobId })
    collected.push(...page.resource.rows)
    await page.commit()
    if (!page.hasMore) break
  }
  const live = adapter.normalizeRecords('invoices', mod.filterResourceRows('invoices', INVOICES), CONTEXT.realmId)
  assert.deepEqual(collected, live)
  assert.equal(qboCalls, 0)
  t.diagnostic(`migration re-run: ${collected.length} rows, ${qboCalls} QuickBooks calls`)
})

test('a fresh read cursor for a new import job re-reads the snapshot from page 1', { skip: MOCKS }, async () => {
  const snapshotId = (globalThis as { __snapshotId?: string }).__snapshotId!
  const first = await mod.fetchSnapshotResourcePage({ companyId: COMPANY, snapshotId, resourceKey: 'accounts', importJobId: 'brand-new-job' })
  assert.equal(first.resource.rows.length, 2, 'a new job starts at page 1, not where another job left off')
})

test('attachments: metadata capture succeeds and is never conflated with binary-download failures', { skip: MOCKS }, async (t) => {
  const [service, orchestrator, manifestMod, reportMod, provider] = await Promise.all([
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-manifest'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-report'),
    import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'),
  ])

  const ATTACHABLES = [
    { Id: 'att-1', FileName: 'ok.pdf' },
    { Id: 'att-2', FileName: 'broken.pdf' },
    { Id: 'att-3', FileName: '' }, // no filename -> counts as a binary failure, metadata still kept
  ]
  const qbProvider = new provider.QuickBooksIntegrationService(CONFIG, ((async (input: string | URL) => {
    const q = new URL(String(input)).searchParams.get('query') ?? ''
    const pos = Number(/STARTPOSITION (\d+)/.exec(q)?.[1] ?? '1')
    const max = Number(/MAXRESULTS (\d+)/.exec(q)?.[1] ?? '1000')
    return json({ QueryResponse: { Attachable: ATTACHABLES.slice(pos - 1, pos - 1 + max), startPosition: pos, maxResults: max } })
  }) as unknown as typeof fetch), NOW) as unknown as {
    getEntityRecords: unknown
    downloadAttachment: (ctx: unknown, id: string) => Promise<{ url: string; content?: ArrayBuffer; contentType?: string }>
  }
  qbProvider.downloadAttachment = async (_ctx, id) => {
    if (id === 'att-2') throw new Error('403 Forbidden')
    return { url: '', content: new TextEncoder().encode('PDFDATA').buffer as ArrayBuffer, contentType: 'application/pdf' }
  }

  const snap = await service.createSnapshot({
    companyId: COMPANY,
    realmId: CONTEXT.realmId,
    userId: USER,
    requestedResources: ['attachments'],
  })
  for (let i = 0; i < 20; i += 1) {
    const outcome = await orchestrator.runSnapshotOrchestratorStep({
      provider: qbProvider as never,
      context: CONTEXT,
      snapshotId: snap.id,
      companyId: COMPANY,
      userId: USER,
    })
    if (outcome.done) break
  }

  const final = await service.getSnapshot(snap.id, COMPANY)
  const cp = (await service.listCheckpoints(snap.id)).find((c) => c.resourceKey === 'attachments')!
  assert.equal(cp.status, 'completed', 'metadata pagination completed')
  assert.equal(cp.recordsWritten, 3, 'all 3 Attachable metadata records captured')
  assert.deepEqual(cp.attachmentSummary, { metadataRecords: 3, binariesDownloaded: 1, binariesFailed: 2 })

  // The failures are preserved explicitly as warnings — not swallowed.
  assert.ok(final!.warnings.some((w) => w.includes('att-2') && w.includes('403')))
  assert.ok(final!.warnings.some((w) => w.includes('2 failed')))

  // attachments is OPTIONAL, so binary failures do not falsely block/allow COMPLETE
  // in a way that hides them — the summary + warnings carry the truth.
  const report = reportMod.renderSnapshotReport(await manifestMod.buildSnapshotManifest(final!))
  assert.match(report, /ATTACHMENTS/)
  assert.match(report, /Metadata \(Attachable\) records: 3/)
  assert.match(report, /Binary files downloaded:\s+1/)
  assert.match(report, /Binary files FAILED:\s+2/)
  assert.match(report, /attachment metadata is captured but some binary files were not downloaded/)

  t.diagnostic(`attachments: metadata 3/3, binaries 1 ok / 2 failed, warnings preserved`)
})
