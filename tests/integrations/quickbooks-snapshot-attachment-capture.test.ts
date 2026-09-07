/**
 * runAttachmentExtraction: storage-budgeted best-effort capture with a durable
 * per-attachment ledger. Injected ports — no live provider / Supabase.
 *
 * Run: npm run test:quickbooks-snapshot
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { SnapshotAttachmentLedgerEntry } from '../../src/lib/import-export/quickbooks/snapshot/snapshot-model'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { runAttachmentExtraction, captureOneAttachment } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-extractor',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-extractor')

/** Fake provider that replays canned Attachable metadata pages. */
function providerReplaying(pages: unknown[][]) {
  return {
    getEntityRecords: async (
      _ctx: unknown,
      _entity: string,
      options: {
        startPosition?: number
        maxPages?: number
        onPage?: (rows: unknown[], cp: Record<string, unknown>) => Promise<void>
        onCheckpoint?: (cp: Record<string, unknown>) => Promise<void>
      },
    ) => {
      let start = options.startPosition ?? 1
      const first = Math.max(0, start - 1)
      const limit = options.maxPages ?? pages.length
      for (let i = first; i < pages.length && i - first < limit; i += 1) {
        const page = pages[i]
        const cp = { startPosition: start + page.length, hasMore: i < pages.length - 1, partitionComplete: false }
        await options.onPage?.(page, cp)
        await options.onCheckpoint?.(cp)
        start += page.length
      }
      return []
    },
  } as never
}

interface Harness {
  writes: Array<{ path: string; bytes: number; contentType: string }>
  ledger: Map<string, SnapshotAttachmentLedgerEntry>
  warnings: string[]
  downloads: string[]
  ports: Parameters<typeof runAttachmentExtraction>[0]['ports']
}

function harness(opts: {
  binary?: (id: string) => { bytes: Uint8Array; contentType: string | null }
  seed?: SnapshotAttachmentLedgerEntry[]
  failWrite?: (path: string) => boolean
} = {}): Harness {
  const writes: Harness['writes'] = []
  const ledger = new Map<string, SnapshotAttachmentLedgerEntry>((opts.seed ?? []).map((e) => [e.attachableId, e]))
  const warnings: string[] = []
  const downloads: string[] = []
  const ports: Harness['ports'] = {
    writeRawPage: async (args: { resourceKey: string; page: number; records: unknown[] }) => {
      const file = `${args.resourceKey}/page-${String(args.page).padStart(6, '0')}.json`
      return [{ file, bytes: JSON.stringify(args.records).length, records: args.records.length }]
    },
    writeBinary: async (path: string, bytes: Uint8Array, contentType: string) => {
      if (opts.failWrite?.(path)) throw new Error('forced storage write failure')
      writes.push({ path, bytes: bytes.length, contentType })
    },
    saveCheckpoint: async () => {},
    loadLedger: async () => [...ledger.values()],
    upsertLedger: async (entry: SnapshotAttachmentLedgerEntry) => {
      ledger.set(entry.attachableId, entry)
    },
    appendWarning: async (message: string) => {
      warnings.push(message)
    },
    downloadBinary: async (id: string) => {
      downloads.push(id)
      const make = opts.binary ?? (() => ({ bytes: new Uint8Array(10), contentType: 'application/pdf' as string | null }))
      return make(id)
    },
  }
  return { writes, ledger, warnings, downloads, ports }
}

const bytesOf = (n: number) => new Uint8Array(n)

async function run(h: Harness, pages: unknown[][], budgetBytes: number, checkpoint = { pagesWritten: 0, recordsWritten: 0, nextStartPosition: 1 }) {
  return runAttachmentExtraction({
    provider: providerReplaying(pages),
    context: { accessToken: 't', realmId: '900' } as never,
    entity: 'Attachable',
    resourceKey: 'attachments',
    snapshotId: 's1',
    storagePrefix: 'c1/quickbooks/900/snapshots/s1',
    budgetBytes,
    pagesPerStep: 40,
    pageSize: 1000,
    checkpoint,
    ports: h.ports,
  })
}

test('B: an attachment that fits is downloaded, written once, and ledgered CAPTURED with its byte size', async () => {
  const h = harness({ binary: () => ({ bytes: bytesOf(300), contentType: 'application/pdf' }) })
  const result = await run(h, [[{ Id: 'a1', FileName: 'a.pdf', Size: 300 }]], 1_000)

  assert.equal(result.status, 'completed')
  assert.equal(result.done, true)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].path, 'attachments/a1/a.pdf')
  const entry = h.ledger.get('a1')!
  assert.equal(entry.status, 'captured')
  assert.equal(entry.capturedBytes, 300)
  assert.equal(entry.storagePath, 'attachments/a1/a.pdf')
  assert.ok(entry.checksum)
})

test('C/R: an attachment that does not fit is NEVER uploaded — no 413 needed to stop it', async () => {
  const h = harness({ binary: () => ({ bytes: bytesOf(5_000), contentType: null }) })
  const result = await run(h, [[{ Id: 'big', FileName: 'big.pdf', Size: 5_000 }]], 1_000)

  assert.equal(h.writes.length, 0, 'writeBinary must not be called for a skipped attachment')
  assert.equal(h.downloads.length, 0, 'a known-oversize attachment is not even downloaded')
  assert.equal(h.ledger.get('big')!.status, 'skipped_budget')
  assert.match(h.ledger.get('big')!.reason ?? '', /exceeds/)
  assert.equal(result.status, 'completed', 'budget exhaustion is not a resource failure')
  assert.equal(result.done, true)
})

test('D: budget is consumed cumulatively across attachments', async () => {
  const h = harness({ binary: (id) => ({ bytes: bytesOf(id === 'a3' ? 400 : 400), contentType: null }) })
  await run(
    h,
    [[
      { Id: 'a1', FileName: 'a1.pdf', Size: 400 },
      { Id: 'a2', FileName: 'a2.pdf', Size: 400 },
      { Id: 'a3', FileName: 'a3.pdf', Size: 400 },
    ]],
    1_000, // fits two 400 B files (800), not the third
  )
  assert.equal(h.ledger.get('a1')!.status, 'captured')
  assert.equal(h.ledger.get('a2')!.status, 'captured')
  assert.equal(h.ledger.get('a3')!.status, 'skipped_budget')
  assert.equal(h.writes.length, 2)
})

test('E: an attachment exactly filling the remaining budget is captured', async () => {
  const h = harness({ binary: () => ({ bytes: bytesOf(1_000), contentType: null }) })
  await run(h, [[{ Id: 'exact', FileName: 'x.pdf', Size: 1_000 }]], 1_000)
  assert.equal(h.ledger.get('exact')!.status, 'captured')
})

test('F: reported Size within budget but actual bytes over budget -> skipped, not written', async () => {
  const h = harness({ binary: () => ({ bytes: bytesOf(2_000), contentType: null }) }) // real size lies
  await run(h, [[{ Id: 'liar', FileName: 'l.pdf', Size: 100 }]], 1_000)
  assert.equal(h.downloads.length, 1, 'downloaded because reported size looked fine')
  assert.equal(h.writes.length, 0, 'but the real 2 KB never gets written past the budget')
  assert.equal(h.ledger.get('liar')!.status, 'skipped_budget')
})

test('unknown Size: downloaded, then checked against the real byte length', async () => {
  const fits = harness({ binary: () => ({ bytes: bytesOf(500), contentType: null }) })
  await run(fits, [[{ Id: 'u1', FileName: 'u1.pdf' }]], 1_000)
  assert.equal(fits.ledger.get('u1')!.status, 'captured')
  assert.equal(fits.ledger.get('u1')!.capturedBytes, 500)

  const over = harness({ binary: () => ({ bytes: bytesOf(5_000), contentType: null }) })
  await run(over, [[{ Id: 'u2', FileName: 'u2.pdf' }]], 1_000)
  assert.equal(over.ledger.get('u2')!.status, 'skipped_budget')
})

test('download failure -> FAILED entry, no throw, resource still completes', async () => {
  const h = harness({
    binary: (id) => {
      if (id === 'boom') throw new Error('403 Forbidden')
      return { bytes: bytesOf(10), contentType: null }
    },
  })
  const result = await run(h, [[{ Id: 'boom', FileName: 'b.pdf', Size: 10 }]], 1_000)
  assert.equal(h.ledger.get('boom')!.status, 'failed')
  assert.match(h.ledger.get('boom')!.reason ?? '', /403/)
  assert.equal(result.status, 'completed')
})

test('I: resume does not re-download or re-count an already CAPTURED attachment', async () => {
  const seed: SnapshotAttachmentLedgerEntry[] = [
    {
      attachableId: 'a1', entityRef: null, fileName: 'a.pdf', contentType: 'application/pdf',
      sourceSize: 300, storagePath: 'attachments/a1/a.pdf', status: 'captured', reason: null,
      capturedBytes: 300, checksum: 'deadbeef',
    },
  ]
  const h = harness({ seed, binary: () => ({ bytes: bytesOf(300), contentType: null }) })
  await run(h, [[
    { Id: 'a1', FileName: 'a.pdf', Size: 300 },
    { Id: 'a2', FileName: 'a2.pdf', Size: 300 },
  ]], 1_000)

  assert.deepEqual(h.downloads, ['a2'], 'a1 is not re-downloaded on resume')
  assert.equal(h.ledger.get('a1')!.status, 'captured')
  assert.equal(h.ledger.get('a2')!.status, 'captured')
  assert.equal(h.writes.length, 1, 'only a2 written this run')
})

test('J: re-running the whole step is idempotent — captured bytes are not double-counted', async () => {
  const pages = [[
    { Id: 'a1', FileName: 'a1.pdf', Size: 400 },
    { Id: 'a2', FileName: 'a2.pdf', Size: 400 },
    { Id: 'a3', FileName: 'a3.pdf', Size: 400 },
  ]]
  const h = harness({ binary: () => ({ bytes: bytesOf(400), contentType: null }) })
  await run(h, pages, 1_000)
  await run(h, pages, 1_000) // retry

  const captured = [...h.ledger.values()].filter((e) => e.status === 'captured')
  assert.equal(captured.length, 2, 'still exactly two captured after retry')
  assert.equal(captured.reduce((s, e) => s + (e.capturedBytes ?? 0), 0), 800)
  assert.equal(h.ledger.get('a3')!.status, 'skipped_budget')
})

test('I: a crash mid-page does not drop or re-capture attachments on resume', async () => {
  const pages = [[
    { Id: 'a1', FileName: 'a1.pdf', Size: 100 },
    { Id: 'a2', FileName: 'a2.pdf', Size: 100 },
    { Id: 'a3', FileName: 'a3.pdf', Size: 100 },
  ]]
  // First run: blow up while persisting the 2nd ledger row (simulated crash).
  const h = harness({ binary: () => ({ bytes: bytesOf(100), contentType: null }) })
  let n = 0
  const realUpsert = h.ports.upsertLedger
  h.ports.upsertLedger = async (entry) => {
    if (++n === 2) throw new Error('worker died mid-page')
    return realUpsert(entry)
  }
  await assert.rejects(() => run(h, pages, 1_000), /worker died mid-page/)
  assert.equal(h.ledger.get('a1')!.status, 'captured')
  assert.equal(h.ledger.has('a3'), false, 'the cursor never advanced past this page')

  // Resume: fresh run over the same page, ledger carried forward.
  h.ports.upsertLedger = realUpsert
  h.downloads.length = 0
  h.writes.length = 0
  await run(h, pages, 1_000)
  assert.deepEqual(h.downloads.sort(), ['a2', 'a3'], 'a1 is not re-downloaded; a2/a3 finish')
  assert.equal([...h.ledger.values()].filter((e) => e.status === 'captured').length, 3)
  assert.equal([...h.ledger.values()].filter((e) => e.status === 'captured').reduce((s, e) => s + (e.capturedBytes ?? 0), 0), 300)
})

test('budget 0: every binary is skipped cleanly, metadata still flows, resource completes', async () => {
  const h = harness()
  const result = await run(h, [[{ Id: 'a1', FileName: 'a.pdf', Size: 1 }]], 0)
  assert.equal(h.writes.length, 0)
  assert.equal(h.downloads.length, 0)
  assert.equal(h.ledger.get('a1')!.status, 'skipped_budget')
  assert.equal(result.status, 'completed')
})

test('captureOneAttachment: no FileName -> UNAVAILABLE, never downloaded', async () => {
  const calls: string[] = []
  const entry = await captureOneAttachment({
    meta: { Id: 'x' },
    id: 'x',
    budgetBytes: 1_000,
    capturedBytes: 0,
    ports: {
      writeBinary: async () => { calls.push('write') },
      downloadBinary: async () => { calls.push('download'); return { bytes: bytesOf(1), contentType: null } },
    },
  })
  assert.equal(entry.status, 'unavailable')
  assert.deepEqual(calls, [])
})
