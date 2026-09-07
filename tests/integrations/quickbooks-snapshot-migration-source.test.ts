import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const { QuickBooksImportAdapter, filterResourceRows } = requireModule(
  '../../src/lib/import-export/sources/quickbooks.adapter',
) as typeof import('../../src/lib/import-export/sources/quickbooks.adapter')

const REALM = '4600'

// A fake provider whose getEntityRecords replays canned raw QBO pages through
// the adapter's real onPage -> onBatch normalization path.
function providerFrom(pages: Record<string, unknown[][]>) {
  return {
    getEntityRecords: async (
      _ctx: unknown,
      entity: string,
      options: {
        onPage?: (rows: unknown[], cp: Record<string, unknown>) => Promise<void>
        onCheckpoint?: (cp: Record<string, unknown>) => Promise<void>
      },
    ) => {
      const entityPages = pages[entity] ?? []
      let start = 1
      for (let i = 0; i < entityPages.length; i += 1) {
        const page = entityPages[i]
        const cp = {
          startPosition: start + page.length,
          extractedCount: start - 1 + page.length,
          hasMore: i < entityPages.length - 1,
          partitionComplete: false,
        }
        await options.onPage?.(page, cp)
        await options.onCheckpoint?.(cp)
        start += page.length
      }
      return []
    },
  } as never
}

/** Normalized rows the LIVE adapter would produce for these raw pages. */
async function liveNormalized(resourceKey: string, entity: string, rawPages: unknown[][]) {
  const adapter = new QuickBooksImportAdapter()
  const collected: Record<string, string>[] = []
  await adapter.fetchResource(providerFrom({ [entity]: rawPages }), { accessToken: 't', realmId: REALM }, resourceKey, {
    companyId: 'c1',
    onBatch: async (rows) => {
      collected.push(...rows)
    },
  })
  return collected
}

/** The exact transform snapshot-source.ts applies to a stored raw page. */
function snapshotNormalized(resourceKey: string, rawRecords: unknown[]) {
  return new QuickBooksImportAdapter().normalizeRecords(resourceKey, filterResourceRows(resourceKey, rawRecords), REALM)
}

const RAW_INVOICES = [
  {
    Id: '101',
    SyncToken: '3',
    DocNumber: 'INV-1',
    TxnDate: '2024-02-02',
    TotalAmt: 115,
    CustomerRef: { value: '7', name: 'Acme' },
    CurrencyRef: { value: 'SAR' },
    Line: [
      { Id: '1', Amount: 100, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '9', name: 'Widget' }, Qty: 2, UnitPrice: 50 } },
    ],
    MetaData: { CreateTime: '2024-02-02T10:00:00Z', LastUpdatedTime: '2024-02-03T10:00:00Z' },
    CustomField: [{ DefinitionId: '1', Name: 'PO', Type: 'StringType', StringValue: 'PO-9' }],
  },
  { Id: '102', SyncToken: '0', DocNumber: 'INV-2', TxnDate: '2024-03-03', TotalAmt: 50, CustomerRef: { value: '8' }, Line: [] },
]

const RAW_CUSTOMERS = [
  { Id: '7', SyncToken: '1', DisplayName: 'Acme', PrimaryEmailAddr: { Address: 'a@acme.test' }, Active: true, Job: false },
  { Id: '31', DisplayName: 'Acme : West', Job: false, ParentRef: { value: '7' }, Active: true }, // sub-customer, filtered out
]

test('snapshot reader normalization equals the live adapter for identical raw invoice input', async () => {
  const live = await liveNormalized('invoices', 'Invoice', [RAW_INVOICES])
  const fromSnapshot = snapshotNormalized('invoices', RAW_INVOICES)
  assert.deepEqual(fromSnapshot, live)
  // Raw provider metadata is preserved for the downstream source_payload archive.
  assert.equal(fromSnapshot[0]._quickbooksEntity, 'Invoice')
  assert.equal(fromSnapshot[0]._realmId, REALM)
  assert.ok(JSON.parse(fromSnapshot[0]._quickbooksRaw as string).Id === '101')
})

test('snapshot reader applies the same resource filtering as the live adapter (sub-customers dropped)', async () => {
  const live = await liveNormalized('customers', 'Customer', [RAW_CUSTOMERS])
  const fromSnapshot = snapshotNormalized('customers', RAW_CUSTOMERS)
  assert.deepEqual(fromSnapshot, live)
  assert.equal(fromSnapshot.length, 1, 'the sub-customer is filtered out, matching live extraction')
})

test('reader refuses a non-COMPLETE snapshot and never falls back to QuickBooks', () => {
  const src = read('src/lib/import-export/quickbooks/snapshot/snapshot-source.ts')
  assert.match(src, /status !== 'COMPLETE'/)
  assert.match(src, /QuickBooks snapshot is not complete/)
  // Same filter + normalize as the live adapter (the attachment ledger lookup is
  // the only extra step, and it never calls QuickBooks).
  assert.match(src, /const filteredRaw = filterResourceRows\(resourceKey, rawRecords\)/)
  assert.match(src, /normalizeRecords\(resourceKey, filteredRaw, snapshot\.realmId\)/)
  assert.doesNotMatch(src, /getEntityRecords|fetchResource|executeForProvider|downloadAttachment/, 'reader must not call QuickBooks')
})

test('import route uses the snapshot page reader when the job carries a snapshotId', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(route, /const snapshotId = typeof body\.snapshotId === 'string'/)
  assert.match(route, /fetchSnapshotResourcePage\(\{ companyId, snapshotId, resourceKey, importJobId: existingJob\.id \}\)/)
  assert.match(route, /: await trace\.measure\('extraction', \(\) => fetchSourceResourcePage\(companyId, sourceKey, resourceKey\)\)/)
})

test('migration session threads snapshotId into config, jobs, and gates on COMPLETE', () => {
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')
  assert.match(service, /QuickBooks snapshot is not complete\./)
  assert.match(service, /snapshotId: session\.config\.snapshotId \?\? null/)
  assert.match(service, /snapshotId: session\.config\.snapshotId/)

  const model = read('src/lib/import-export/wizard/migration-session.ts')
  assert.match(model, /snapshotId\?: string \| null/)
  assert.match(model, /snapshotId: input\.snapshotId \?\? null/)

  const importJob = read('src/lib/import-export/jobs/import-job.service.ts')
  assert.match(importJob, /snapshot_id: input\.snapshotId \?\? null/)
})

test('migration 069 adds the read-cursor table and import_jobs.snapshot_id', () => {
  const sql = read('supabase/migrations/069_quickbooks_migration_snapshots.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.quickbooks_snapshot_read_cursors/)
  assert.match(sql, /PRIMARY KEY \(import_job_id, resource_key\)/)
  assert.match(sql, /ALTER TABLE public\.import_jobs\s+ADD COLUMN IF NOT EXISTS snapshot_id UUID/)
})
