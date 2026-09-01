import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import type { DuplicateMatch, MappedRow, ModuleDefinition, ValidationResult } from '../../src/lib/import-export/types'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://batching-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-test'

const { processImport } = requireModule('../../src/lib/import-export/import/import-processor') as typeof import('../../src/lib/import-export/import/import-processor')

// ---------------------------------------------------------------------------
// A minimal in-memory PostgREST that records every request so the test can
// assert "100 records != 100 round trips". Only the migration-tracking tables
// are exercised by the master-page path.
// ---------------------------------------------------------------------------
interface FakeDb {
  calls: Array<{ method: string; table: string }>
  records: Map<string, Record<string, unknown>>
  links: Array<Record<string, unknown>>
  reset(): void
  install(): void
  restore(): void
}

function createFakeDb(): FakeDb {
  const realFetch = globalThis.fetch
  const db: FakeDb = {
    calls: [],
    records: new Map(),
    links: [],
    reset() { this.calls = []; this.records = new Map(); this.links = [] },
    install() {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (!url.hostname.endsWith('.supabase.co')) return realFetch(input, init)
        const method = String(init?.method ?? 'GET').toUpperCase()
        const table = url.pathname.replace('/rest/v1/', '')
        db.calls.push({ method, table })
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

        if (method === 'GET') {
          const inParam = url.searchParams.get('source_id') ?? ''
          const ids = inParam.startsWith('in.')
            ? inParam.slice(3).replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).filter(Boolean)
            : []
          if (table === 'quickbooks_migration_records') {
            return json(ids.map((id) => db.records.get(id)).filter(Boolean))
          }
          if (table === 'quickbooks_migration_local_links') {
            return json(db.links.filter((link) => ids.includes(String(link.source_id))))
          }
          return json([])
        }
        if (method === 'POST') {
          const parsed = JSON.parse(String(init?.body ?? '[]')) as unknown
          const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>
          for (const row of rows) {
            if (table === 'quickbooks_migration_records') {
              const key = String(row.source_id)
              db.records.set(key, { ...(db.records.get(key) ?? {}), ...row })
            } else if (table === 'quickbooks_migration_local_links') {
              const dupe = db.links.some((existing) => existing.source_id === row.source_id && existing.local_table === row.local_table && existing.local_id === row.local_id)
              if (!dupe) db.links.push(row)
            }
          }
          return json(null, 201)
        }
        return json(null, 204)
      }) as typeof globalThis.fetch
    },
    restore() { globalThis.fetch = realFetch },
  }
  return db
}

function countBy(calls: Array<{ method: string; table: string }>, method: string, table: string): number {
  return calls.filter((call) => call.method === method && call.table === table).length
}

interface ModuleSpy { created: string[]; updated: string[]; failOn: Set<string> }

function vendorLikeModule(spy: ModuleSpy): ModuleDefinition {
  return {
    key: 'vendors',
    displayName: 'Vendors',
    fields: [{ key: 'name', label: 'Name', type: 'string' }],
    duplicateKeys: ['name'],
    async findDuplicate() { return null },
    async findDuplicatesBatch(rows) {
      // Simulate the native-table duplicate lookup: a row is a duplicate once its
      // source id has already been created in a prior run.
      return rows
        .filter((row) => spy.created.includes(String((row.mapped as Record<string, unknown>)._quickbooksId)))
        .map((row): DuplicateMatch => ({ rowNumber: row.rowNumber, existingId: `local-${(row.mapped as Record<string, unknown>)._quickbooksId}`, matchedOn: ['name'] }))
    },
    async createRecord(record) {
      const sourceId = String((record as Record<string, unknown>)._quickbooksId)
      if (spy.failOn.has(sourceId)) throw new Error(`synthetic create failure for ${sourceId}`)
      spy.created.push(sourceId)
      return { id: `local-${sourceId}` }
    },
    async updateRecord(id) { spy.updated.push(id) },
    async exportRecords() { return [] },
    mapExportRow() { return {} },
  }
}

function qbVendorRows(count: number, opts: { currency?: string } = {}): MappedRow[] {
  return Array.from({ length: count }, (_, index) => {
    const sourceId = `qb-${index + 1}`
    const raw: Record<string, unknown> = { Id: sourceId, DisplayName: `Vendor ${index + 1}` }
    if (opts.currency) raw.CurrencyRef = { value: opts.currency }
    return {
      rowNumber: index + 1,
      source: { name: `Vendor ${index + 1}` },
      mapped: {
        name: `Vendor ${index + 1}`,
        _realmId: 'realm-1',
        _quickbooksEntity: 'Vendor',
        _quickbooksId: sourceId,
        _quickbooksRaw: JSON.stringify(raw),
      },
    }
  })
}

function validationFor(rows: MappedRow[]): ValidationResult {
  return { validRowNumbers: rows.map((row) => row.rowNumber), invalidRowNumbers: [], issues: [], errorCount: 0, warningCount: 0, summaryByCode: {} }
}

// ---------------------------------------------------------------------------

test('a 100-record master page uses a fixed number of tracking round trips, not one per record', async () => {
  const db = createFakeDb()
  db.install()
  try {
    db.reset()
    const spy: ModuleSpy = { created: [], updated: [], failOn: new Set() }
    const rows = qbVendorRows(100)
    const result = await processImport({
      module: vendorLikeModule(spy),
      rows,
      validation: validationFor(rows),
      duplicateStrategy: 'skip',
      duplicateMatches: [],
      ctx: { companyId: 'company-1', userId: 'user-1' },
    })

    assert.equal(result.importedCount, 100)
    assert.equal(result.failedCount, 0)
    assert.equal(result.skippedCount, 0)
    assert.equal(spy.created.length, 100, 'native create stays per-record (documented)')

    // The whole point of Phase 4: tracking writes/reads are per-page, not per-record.
    assert.equal(countBy(db.calls, 'POST', 'quickbooks_migration_records'), 2, 'source archive + link archive = 2 upserts')
    assert.equal(countBy(db.calls, 'POST', 'quickbooks_migration_local_links'), 1, 'one multi-row link upsert')
    assert.equal(countBy(db.calls, 'GET', 'quickbooks_migration_records'), 2, 'prefetch + verification re-read')
    assert.equal(countBy(db.calls, 'GET', 'quickbooks_migration_local_links'), 2, 'prefetch + verification re-read')

    const trackingCalls = db.calls.filter((call) => call.table.startsWith('quickbooks_migration_')).length
    assert.equal(trackingCalls, 7)
    assert.ok(trackingCalls / 100 < 0.1, `tracking round trips per record = ${trackingCalls / 100}, must be well under the pre-Phase-4 ~5`)
  } finally {
    db.restore()
  }
})

test('replaying the same page is idempotent: nothing is re-created, links are repaired', async () => {
  const db = createFakeDb()
  db.install()
  try {
    db.reset()
    const spy: ModuleSpy = { created: [], updated: [], failOn: new Set() }
    const rows = qbVendorRows(10)
    const testMod = vendorLikeModule(spy)
    const input = { module: testMod, rows, validation: validationFor(rows), duplicateStrategy: 'skip' as const, duplicateMatches: [] as DuplicateMatch[], ctx: { companyId: 'company-1', userId: 'user-1' } }

    const first = await processImport(input)
    assert.equal(first.importedCount, 10)

    // Second run: findDuplicatesBatch now reports every row as an existing native
    // record (as the real repo query would after the first run committed).
    const replayMatches = await testMod.findDuplicatesBatch!(rows, input.ctx)
    const replay = await processImport({ ...input, duplicateMatches: replayMatches })

    assert.equal(replay.importedCount, 0, 'no duplicate native rows on replay')
    assert.equal(replay.skippedCount, 10)
    assert.equal(spy.created.length, 10, 'createRecord not called again')
    assert.equal(db.records.size, 10)
    assert.equal(db.links.length, 10, 'exactly one link per source record, no duplicates')
  } finally {
    db.restore()
  }
})

test('one bad record fails in isolation; the rest of the page still materializes and links', async () => {
  const db = createFakeDb()
  db.install()
  try {
    db.reset()
    const spy: ModuleSpy = { created: [], updated: [], failOn: new Set(['qb-3']) }
    const rows = qbVendorRows(5)
    const result = await processImport({
      module: vendorLikeModule(spy),
      rows,
      validation: validationFor(rows),
      duplicateStrategy: 'skip',
      duplicateMatches: [],
      ctx: { companyId: 'company-1', userId: 'user-1' },
    })

    assert.equal(result.importedCount, 4)
    assert.equal(result.failedCount, 1)
    assert.equal(result.errors[0]?.rowNumber, 3)
    assert.match(result.errors[0]?.message ?? '', /native_create:/)
    assert.equal(db.links.length, 4, 'the failed record is not linked')
    // The batched source archive still ran once for the whole page.
    assert.equal(countBy(db.calls, 'POST', 'quickbooks_migration_records'), 2)
  } finally {
    db.restore()
  }
})

test('currency-carrying rows upsert company_currencies once per page, not per record', async () => {
  const db = createFakeDb()
  db.install()
  try {
    db.reset()
    const spy: ModuleSpy = { created: [], updated: [], failOn: new Set() }
    const rows = qbVendorRows(20, { currency: 'USD' })
    const result = await processImport({
      module: vendorLikeModule(spy),
      rows,
      validation: validationFor(rows),
      duplicateStrategy: 'skip',
      duplicateMatches: [],
      ctx: { companyId: 'company-1', userId: 'user-1' },
    })

    assert.equal(result.importedCount, 20)
    // Per-record archiving would have been ~2 company_currencies upserts per row (40);
    // batched it is one upsert of the page's distinct codes per archive call.
    const currencyUpserts = countBy(db.calls, 'POST', 'company_currencies')
    assert.ok(currencyUpserts <= 2, `company_currencies upserts = ${currencyUpserts}, must be <= 2 (once per archive pass), not ~40`)
    assert.equal(countBy(db.calls, 'GET', 'companies'), 0, 'no exchange rate on a plain CurrencyRef -> no companies read')
  } finally {
    db.restore()
  }
})

// ---------------------------------------------------------------------------
// Structural guarantees
// ---------------------------------------------------------------------------

test('the batch path is gated to QuickBooks master modules only', () => {
  const processor = readFileSync('src/lib/import-export/import/import-processor.ts', 'utf8')
  assert.match(processor, /const QUICKBOOKS_BATCH_MASTER_MODULES = new Set\(\['accounts', 'customers', 'vendors', 'employees'\]\)/)
  assert.match(processor, /if \(isQuickBooksMasterMigrationPage\(input\)\) \{\s*return processQuickBooksMasterPage\(input\)/)
  // Ledger / extended / CSV modules keep the per-record loop verbatim.
  assert.match(processor, /measure\('native_create'/)
  assert.match(processor, /measure\('accounting_materialization'/)
  assert.match(processor, /measure\('source_hash_check'/)
})

test('the batch path finishes all materialization before returning (Phase 3 commit invariant)', () => {
  const processor = readFileSync('src/lib/import-export/import/import-processor.ts', 'utf8')
  const route = readFileSync('src/app/api/import-export/[module]/import/route.ts', 'utf8')
  // processImport() is awaited to completion in trace.measure('materialization', ...)
  // and only then does the hasMore branch commit the checkpoint.
  assert.match(route, /trace\.measure\('materialization', \(\) => processImport\(/)
  const branchStart = route.indexOf('if (sourcePage?.hasMore)')
  assert.ok(route.indexOf('await sourcePage.commit()', branchStart) > route.indexOf('const result = await trace.measure'))
  // The batch path performs every native create + link + verify inside itself.
  assert.match(processor, /Phase D — per-record dependency validation \+ native create\/update/)
  assert.match(processor, /Phase F — one re-read of the tracking state/)
})

test('link verification is preserved, just batched', () => {
  const store = readFileSync('src/lib/import-export/quickbooks/migration-store.ts', 'utf8')
  // Same three failure messages as the per-record assertQuickBooksRecordLinked.
  assert.match(store, /was preserved but did not complete native materialization/)
  assert.match(store, /linked to an unexpected native record/)
  assert.match(store, /has no durable native migration link/)
  assert.match(store, /export function verifyQuickBooksRecordLinked/)
})

test('Phase 1 / 2 / 3 code is untouched by Phase 4', () => {
  const route = readFileSync('src/app/api/import-export/[module]/import/route.ts', 'utf8')
  const workers = readFileSync('src/lib/platform/jobs/workers.ts', 'utf8')
  const registry = readFileSync('src/lib/import-export/sources/source-registry.ts', 'utf8')
  // Phase 1
  assert.match(route, /PROGRESS_EVENT_MILESTONES = new Set\(\['batch_completed', 'stage_failed', 'stage_completed'\]\)/)
  // Phase 2
  assert.match(workers, /registerPostCompleteHook\('QUICKBOOKS_IMPORT_STEP'/)
  assert.match(workers, /await completeJob\(jobId, \(result \?\? \{\}\) as Record<string, unknown>, attempt\)/)
  // Phase 3
  assert.match(registry, /Defense in depth against an unbounded continuation chain/)
  assert.match(registry, /quickbooks\.migration\.checkpoint\.stall_detected/)
})
