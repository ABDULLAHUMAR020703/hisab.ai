/**
 * Snapshot-backed migration must participate in master's page-batch processImport
 * path (ab0c758) for accounts / customers / vendors — NOT a separate processor.
 *
 * The batch gate `isQuickBooksMasterMigrationPage` keys purely off row SHAPE
 * (`_realmId` + `_quickbooksEntity` + `_quickbooksRaw`). This feeds `processImport`
 * rows produced by the exact snapshot-source transform
 * (`adapter.normalizeRecords(key, filterResourceRows(key, rawPage), realm)`) and
 * asserts the per-PAGE tracking round-trip pattern, proving the snapshot rows
 * take `processQuickBooksMasterPage` identically to a live extraction page.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import type { DuplicateMatch, MappedRow, ModuleDefinition, ValidationResult } from '../../src/lib/import-export/types'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://snapshot-batching-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-test'

const { processImport } = requireModule('../../src/lib/import-export/import/import-processor') as typeof import('../../src/lib/import-export/import/import-processor')
const { QuickBooksImportAdapter, filterResourceRows } = requireModule('../../src/lib/import-export/sources/quickbooks.adapter') as typeof import('../../src/lib/import-export/sources/quickbooks.adapter')

const REALM = 'realm-snap'

/** Minimal in-memory PostgREST that records every request (from master's batching test). */
function createFakeDb() {
  const realFetch = globalThis.fetch
  const db = {
    calls: [] as Array<{ method: string; table: string }>,
    records: new Map<string, Record<string, unknown>>(),
    links: [] as Array<Record<string, unknown>>,
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
          if (table === 'quickbooks_migration_records') return json(ids.map((id) => db.records.get(id)).filter(Boolean))
          if (table === 'quickbooks_migration_local_links') return json(db.links.filter((l) => ids.includes(String(l.source_id))))
          return json([])
        }
        if (method === 'POST') {
          const parsed = JSON.parse(String(init?.body ?? '[]')) as unknown
          const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>
          for (const row of rows) {
            if (table === 'quickbooks_migration_records') {
              db.records.set(String(row.source_id), { ...(db.records.get(String(row.source_id)) ?? {}), ...row })
            } else if (table === 'quickbooks_migration_local_links') {
              const dupe = db.links.some((e) => e.source_id === row.source_id && e.local_table === row.local_table && e.local_id === row.local_id)
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

const countBy = (calls: Array<{ method: string; table: string }>, method: string, table: string) =>
  calls.filter((c) => c.method === method && c.table === table).length

interface ModuleSpy { created: string[]; updated: string[] }

function masterModule(key: 'accounts' | 'customers' | 'vendors', spy: ModuleSpy): ModuleDefinition {
  return {
    key,
    displayName: key,
    fields: [{ key: 'name', label: 'Name', type: 'string' }],
    duplicateKeys: ['name'],
    async findDuplicate() { return null },
    async findDuplicatesBatch() { return [] },
    async createRecord(record) {
      const sourceId = String((record as Record<string, unknown>)._quickbooksId)
      spy.created.push(sourceId)
      return { id: `local-${sourceId}` }
    },
    async updateRecord(id) { spy.updated.push(String(id)) },
    async exportRecords() { return [] },
    mapExportRow() { return {} },
  } as ModuleDefinition
}

/** Raw QBO entities → the exact rows snapshot-source hands to processImport. */
function snapshotRows(resourceKey: 'accounts' | 'customers' | 'vendors', entity: string, count: number): MappedRow[] {
  const raw = Array.from({ length: count }, (_, i) => {
    const id = `qb-${i + 1}`
    if (entity === 'Account') return { Id: id, Name: `Account ${i + 1}`, AcctNum: String(1000 + i), AccountType: 'Bank', Active: true }
    return { Id: id, DisplayName: `${entity} ${i + 1}`, Active: true, Job: false }
  })
  const normalized = new QuickBooksImportAdapter().normalizeRecords(resourceKey, filterResourceRows(resourceKey, raw), REALM)
  return normalized.map((mapped, i) => ({ rowNumber: i + 1, source: mapped, mapped }))
}

const validationFor = (rows: MappedRow[]): ValidationResult => ({
  validRowNumbers: rows.map((r) => r.rowNumber),
  invalidRowNumbers: [],
  issues: [],
  errorCount: 0,
  warningCount: 0,
  summaryByCode: {},
})

for (const [resourceKey, entity] of [['accounts', 'Account'], ['customers', 'Customer'], ['vendors', 'Vendor']] as const) {
  test(`snapshot-sourced ${resourceKey} page takes the master batch path (per-page tracking I/O)`, async () => {
    const db = createFakeDb()
    db.install()
    try {
      db.reset()
      const spy: ModuleSpy = { created: [], updated: [] }
      const rows = snapshotRows(resourceKey, entity, 50)

      // Precondition: the rows carry exactly the fields the batch gate checks.
      for (const row of rows) {
        const m = row.mapped as Record<string, unknown>
        assert.equal(typeof m._realmId, 'string')
        assert.ok((m._realmId as string).length > 0)
        assert.equal(m._quickbooksEntity, entity)
        assert.ok(m._quickbooksRaw !== undefined && m._quickbooksRaw !== null)
      }

      const result = await processImport({
        module: masterModule(resourceKey, spy),
        rows,
        validation: validationFor(rows),
        duplicateStrategy: 'skip',
        duplicateMatches: [] as DuplicateMatch[],
        ctx: { companyId: 'company-1', userId: 'user-1' },
      })

      assert.equal(result.importedCount, 50)
      assert.equal(result.failedCount, 0)
      assert.equal(spy.created.length, 50, 'native create stays per-record')

      // The batch-path signature: tracking writes/reads are per-PAGE, a fixed
      // handful — not ~5 per record like the pre-batch loop.
      const trackingCalls = db.calls.filter((c) => c.table.startsWith('quickbooks_migration_')).length
      assert.ok(trackingCalls <= 8, `tracking round trips = ${trackingCalls}; the per-record loop would be ~250`)
      assert.equal(countBy(db.calls, 'POST', 'quickbooks_migration_records'), 2, 'source archive + link archive = 2 upserts for the whole page')
      assert.equal(countBy(db.calls, 'POST', 'quickbooks_migration_local_links'), 1, 'one multi-row link upsert for the whole page')
    } finally {
      db.restore()
    }
  })
}

test('snapshot migration does not introduce a parallel processor — it calls the shared processImport', () => {
  const src = requireModule('node:fs').readFileSync(
    requireModule('node:path').resolve(process.cwd(), 'src/lib/import-export/quickbooks/snapshot/snapshot-source.ts'),
    'utf8',
  ) as string
  assert.doesNotMatch(src, /processImport|processQuickBooksMasterPage/, 'snapshot-source only produces rows; the route runs processImport')
  const route = requireModule('node:fs').readFileSync(
    requireModule('node:path').resolve(process.cwd(), 'src/app/api/import-export/[module]/import/route.ts'),
    'utf8',
  ) as string
  assert.match(route, /trace\.measure\('materialization', \(\) => processImport\(/, 'the one shared processImport call handles snapshot + live')
})
