import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { QuickBooksIntegrationService } = requireModule(
  '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service',
) as typeof import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service')
const { runQueryExtraction, accumulatePartitionWindow } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-extractor',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-extractor')
const { getSnapshotResourceSpec } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-resources',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-resources')
const { validateSnapshot } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-validation',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-validation')
const { computeSnapshotStatus } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-model',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-model')

const CONFIG = { clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/cb', environment: 'sandbox' as const, additionalScopes: [] }
const CONTEXT = { accessToken: 'token', realmId: '900' }
const NOW = () => new Date('2026-01-01T00:00:00.000Z') // last window boundary => 2027-01-01

// Invoices spanning three provider 10-year windows from earliest 2001-06-15:
//   [2001-06-15, 2011-06-15) : 3   [2011-06-15, 2021-06-15) : 2   [2021-06-15, 2027-01-01) : 4
const INVOICES = [
  { Id: '1', TxnDate: '2001-06-15' },
  { Id: '2', TxnDate: '2004-01-01' },
  { Id: '3', TxnDate: '2010-12-31' },
  { Id: '4', TxnDate: '2011-06-15' },
  { Id: '5', TxnDate: '2019-09-09' },
  { Id: '6', TxnDate: '2021-06-15' },
  { Id: '7', TxnDate: '2023-02-02' },
  { Id: '8', TxnDate: '2024-05-05' },
  { Id: '9', TxnDate: '2025-11-30' },
]

function makeFetch(opts: { calls?: string[] } = {}): typeof fetch {
  return (async (input: string | URL): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString()
    opts.calls?.push(urlStr)
    const query = new URL(urlStr).searchParams.get('query') ?? ''
    if (/ORDERBY TxnDate ASC/.test(query) && /MAXRESULTS 1/.test(query)) {
      return json({ QueryResponse: { Invoice: [INVOICES[0]], startPosition: 1, maxResults: 1 } })
    }
    const range = /TxnDate >= '([\d-]+)' AND TxnDate < '([\d-]+)'/.exec(query)
    const pos = Number(/STARTPOSITION (\d+)/.exec(query)?.[1] ?? '1')
    const max = Number(/MAXRESULTS (\d+)/.exec(query)?.[1] ?? '1000')
    let rows = INVOICES
    if (range) rows = rows.filter((r) => r.TxnDate >= range[1] && r.TxnDate < range[2])
    const slice = rows.slice(pos - 1, pos - 1 + max)
    return json({ QueryResponse: { Invoice: slice, startPosition: pos, maxResults: max } })
  }) as unknown as typeof fetch
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

interface FakeCheckpoint {
  pagesWritten: number
  recordsWritten: number
  nextStartPosition: number
  partitionStart: string | null
  partitions: Array<{ start: string; end: string; records: number }>
  status?: string
  lastPageFile?: string | null
}

function harness(failOnWriteNumber?: number) {
  const writes: Array<{ file: string; page: number; records: unknown[]; partitionStart?: string; partitionEnd?: string }> = []
  const checkpointSaves: Array<Partial<FakeCheckpoint>> = []
  let checkpoint: FakeCheckpoint = {
    pagesWritten: 0,
    recordsWritten: 0,
    nextStartPosition: 1,
    partitionStart: null,
    partitions: [],
  }
  const ports = {
    writeRawPage: async (args: {
      resourceKey: string
      page: number
      records: unknown[]
      partitionStart?: string
      partitionEnd?: string
    }) => {
      if (failOnWriteNumber && writes.length + 1 === failOnWriteNumber) {
        throw new Error('simulated upload failure')
      }
      const file = `${args.resourceKey}/page-${String(args.page).padStart(6, '0')}.json`
      writes.push({ file, page: args.page, records: args.records, partitionStart: args.partitionStart, partitionEnd: args.partitionEnd })
      return [{ file, bytes: JSON.stringify(args.records).length, records: args.records.length }]
    },
    saveCheckpoint: async (_resourceKey: string, patch: Record<string, unknown>) => {
      checkpointSaves.push({ ...patch })
      checkpoint = { ...checkpoint, ...(patch as Partial<FakeCheckpoint>) }
    },
  }
  return {
    writes,
    checkpointSaves,
    get checkpoint() {
      return checkpoint
    },
    ports: ports as never,
  }
}

async function runToDone(fetchImpl: ReturnType<typeof makeFetch>, pagesPerStep: number) {
  const provider = new QuickBooksIntegrationService(CONFIG, fetchImpl, NOW)
  const spec = getSnapshotResourceSpec('invoices')!
  const h = harness()
  let steps = 0
  for (; steps < 50; steps += 1) {
    const result = await runQueryExtraction({
      provider,
      context: CONTEXT,
      spec,
      snapshotId: 's1',
      storagePrefix: 'c1/quickbooks/900/snapshots/s1',
      checkpoint: h.checkpoint,
      pagesPerStep,
      pageSize: 2,
      ports: h.ports,
    })
    if (result.done) break
  }
  return { ...h, steps: steps + 1 }
}

test('partitioned extraction: raw pages written, checkpoint follows persistence, windows contiguous', async () => {
  const h = await runToDone(makeFetch(), 100)

  // Every write is a raw QBO page (untransformed Ids present).
  assert.equal(h.writes.reduce((n, w) => n + w.records.length, 0), 9)
  for (const w of h.writes) {
    for (const rec of w.records as Array<{ Id?: string }>) assert.ok(rec.Id, 'raw record must keep its QuickBooks Id')
  }

  // Page files are numbered 1..N with no gap.
  const pages = h.writes.map((w) => w.page).sort((a, b) => a - b)
  assert.deepEqual(pages, Array.from({ length: pages.length }, (_, i) => i + 1))

  // Three contiguous partition windows, end == next start, no gap/overlap.
  const windows = h.checkpoint.partitions
  assert.equal(windows.length, 3)
  assert.deepEqual(
    windows.map((w) => w.start.slice(0, 10)),
    ['2001-06-15', '2011-06-15', '2021-06-15'],
  )
  for (let i = 1; i < windows.length; i += 1) {
    assert.equal(windows[i - 1].end.slice(0, 10), windows[i].start.slice(0, 10), 'window end must equal next window start')
  }
  assert.equal(windows.at(-1)!.end.slice(0, 10), '2027-01-01', 'last window ends at the provider horizon')
  assert.deepEqual(windows.map((w) => w.records), [3, 2, 4])

  // Each page write carries the partition bounds it belongs to, and its records
  // fall inside that window.
  for (const w of h.writes) {
    assert.ok(w.partitionStart && w.partitionEnd, 'partitioned page must record its window bounds')
    for (const rec of w.records as Array<{ TxnDate: string }>) {
      assert.ok(w.partitionStart!.slice(0, 10) <= rec.TxnDate && rec.TxnDate < w.partitionEnd!.slice(0, 10))
    }
  }
})

test('checkpoint advances exactly once per successfully persisted page', async () => {
  const h = await runToDone(makeFetch(), 100)
  const advancing = h.checkpointSaves.filter((p) => typeof p.pagesWritten === 'number' && p.lastPageFile)
  assert.equal(advancing.length, h.writes.length, 'one advancing checkpoint save per written page')
  // The final advance matches the total.
  assert.equal(h.checkpoint.pagesWritten, h.writes.length)
  assert.equal(h.checkpoint.recordsWritten, 9)
})

test('continuation across many small steps produces the same complete result', async () => {
  const single = await runToDone(makeFetch(), 100)
  const chunked = await runToDone(makeFetch(), 1) // one provider page per step

  assert.ok(chunked.steps > single.steps, 'chunked run must take more steps')
  assert.deepEqual(
    chunked.writes.map((w) => w.records.length),
    single.writes.map((w) => w.records.length),
  )
  assert.deepEqual(chunked.checkpoint.partitions, single.checkpoint.partitions)
  assert.equal(chunked.checkpoint.recordsWritten, 9)
  // No page written twice on resume.
  const ids = chunked.writes.flatMap((w) => (w.records as Array<{ Id: string }>).map((r) => r.Id))
  assert.equal(new Set(ids).size, ids.length, 'no QuickBooks Id persisted more than once across resumed steps')
})

test('an upload failure does not advance the checkpoint past the failed page', async () => {
  const provider = new QuickBooksIntegrationService(CONFIG, makeFetch(), NOW)
  const spec = getSnapshotResourceSpec('invoices')!
  const h = harness(2) // fail the 2nd page write

  await assert.rejects(
    runQueryExtraction({
      provider,
      context: CONTEXT,
      spec,
      snapshotId: 's1',
      storagePrefix: 'c1/quickbooks/900/snapshots/s1',
      checkpoint: h.checkpoint,
      pagesPerStep: 100,
      pageSize: 2,
      ports: h.ports,
    }),
    /simulated upload failure/,
  )

  assert.equal(h.writes.length, 1, 'only the first page persisted')
  assert.equal(h.checkpoint.pagesWritten, 1, 'checkpoint reflects exactly the persisted page')
  assert.equal(h.checkpoint.recordsWritten, 2)
  // No advancing checkpoint save for the page that failed to upload.
  const advancing = h.checkpointSaves.filter((p) => p.pagesWritten === 2)
  assert.equal(advancing.length, 0)
})

test('the extracted snapshot passes validation (no boundary gap/overlap, no duplicate Ids)', async () => {
  const h = await runToDone(makeFetch(), 100)
  const pageBodies = new Map(h.writes.map((w) => [w.file, w.records]))

  const entities = {
    invoices: {
      resourceKey: 'invoices',
      entity: 'Invoice',
      status: 'completed' as const,
      extractionMode: 'partitioned' as const,
      pages: h.writes.length,
      records: 9,
      files: h.writes.map((w) => w.file),
      partitions: h.checkpoint.partitions,
    },
  }
  const report = await validateSnapshot(
    {
      snapshotId: 's1',
      companyId: 'c1',
      realmId: '900',
      status: 'RUNNING',
      storageBucket: 'quickbooks-migration',
      storagePrefix: 'c1/quickbooks/900/snapshots/s1',
      extractorVersion: 'test',
      startedAt: NOW().toISOString(),
      completedAt: null,
      sourceCompany: null,
      requiredResources: ['invoices'],
      requestedResources: ['invoices'],
      entities,
      errors: [],
      warnings: [],
    },
    { readPage: async (file) => pageBodies.get(file) ?? [] },
  )
  assert.equal(report.ok, true, JSON.stringify(report.issues))
  assert.equal(computeSnapshotStatus(entities, ['invoices']), 'COMPLETE')
})

test('accumulatePartitionWindow tallies pages of the same window into one entry', () => {
  const windows: Array<{ start: string; end: string; records: number }> = []
  accumulatePartitionWindow(windows, '2001-06-15T00:00:00.000Z', '2011-06-15T00:00:00.000Z', 2) // page 1
  accumulatePartitionWindow(windows, '2001-06-15T00:00:00.000Z', '2011-06-15T00:00:00.000Z', 1) // page 2, resumed step
  accumulatePartitionWindow(windows, '2001-06-15T00:00:00.000Z', '2011-06-15T00:00:00.000Z', 0) // partitionComplete marker
  accumulatePartitionWindow(windows, '2011-06-15T00:00:00.000Z', '2021-06-15T00:00:00.000Z', 2)
  assert.equal(windows.length, 2)
  assert.deepEqual(windows.map((w) => w.records), [3, 2])
})
