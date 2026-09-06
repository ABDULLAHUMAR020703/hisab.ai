import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSnapshot } from '../../src/lib/import-export/quickbooks/snapshot/snapshot-validation'
import type {
  SnapshotEntitySummary,
  SnapshotManifest,
} from '../../src/lib/import-export/quickbooks/snapshot/snapshot-model'

function manifest(entities: Record<string, Partial<SnapshotEntitySummary>>, overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  const full: Record<string, SnapshotEntitySummary> = {}
  for (const [key, value] of Object.entries(entities)) {
    full[key] = {
      resourceKey: key,
      entity: value.entity ?? 'Invoice',
      status: value.status ?? 'completed',
      extractionMode: value.extractionMode ?? 'full',
      pages: value.pages ?? 0,
      records: value.records ?? 0,
      files: value.files ?? [],
      partitions: value.partitions,
      error: value.error,
      unsupportedReason: value.unsupportedReason,
      unsupportedStatus: value.unsupportedStatus,
    }
  }
  return {
    snapshotId: 's1',
    companyId: 'c1',
    realmId: 'r1',
    status: 'RUNNING',
    storageBucket: 'quickbooks-migration',
    storagePrefix: 'c1/quickbooks/r1/snapshots/s1',
    extractorVersion: 'test',
    startedAt: new Date().toISOString(),
    completedAt: null,
    sourceCompany: null,
    requiredResources: ['accounts', 'invoices'],
    requestedResources: ['accounts', 'invoices'],
    entities: full,
    errors: [],
    warnings: [],
    ...overrides,
  }
}

test('not terminal → not ok', async () => {
  const report = await validateSnapshot(manifest({ accounts: { status: 'completed' }, invoices: { status: 'running' } }))
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'not_terminal'))
})

test('failed required resource → not ok', async () => {
  const report = await validateSnapshot(
    manifest({ accounts: { status: 'completed' }, invoices: { status: 'failed', error: 'boom' } }),
  )
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'required_failed'))
})

test('unsupported required resource → not ok, distinct code', async () => {
  const report = await validateSnapshot(
    manifest({ accounts: { status: 'completed' }, invoices: { status: 'unsupported', unsupportedStatus: 400 } }),
  )
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'required_unsupported'))
  assert.ok(!report.issues.some((i) => i.code === 'required_failed'))
})

test('page numbering gap detected', async () => {
  const report = await validateSnapshot(
    manifest({
      accounts: { status: 'completed', pages: 2, files: ['accounts/page-000001.json', 'accounts/page-000003.json'] },
      invoices: { status: 'completed' },
    }),
  )
  assert.ok(report.issues.some((i) => i.code === 'page_gap'))
})

test('partition gap and overlap detected across the whole resource', async () => {
  const gap = await validateSnapshot(
    manifest({
      accounts: { status: 'completed' },
      invoices: {
        status: 'completed',
        extractionMode: 'partitioned',
        partitions: [
          { start: '2020-01-01', end: '2021-01-01', records: 5 },
          { start: '2021-06-01', end: '2022-01-01', records: 5 },
        ],
      },
    }),
  )
  assert.ok(gap.issues.some((i) => i.code === 'partition_gap'))

  const overlap = await validateSnapshot(
    manifest({
      accounts: { status: 'completed' },
      invoices: {
        status: 'completed',
        extractionMode: 'partitioned',
        partitions: [
          { start: '2020-01-01', end: '2021-06-01', records: 5 },
          { start: '2021-01-01', end: '2022-01-01', records: 5 },
        ],
      },
    }),
  )
  assert.ok(overlap.issues.some((i) => i.code === 'partition_overlap'))
})

test('deep check flags duplicate QuickBooks Id across pages AND partitions', async () => {
  const pages: Record<string, unknown[]> = {
    'invoices/page-000001.json': [{ Id: '1' }, { Id: '2' }],
    'invoices/page-000002.json': [{ Id: '3' }, { Id: '2' }], // '2' repeats across pages
  }
  const report = await validateSnapshot(
    manifest({
      accounts: { status: 'completed' },
      invoices: {
        status: 'completed',
        entity: 'Invoice',
        pages: 2,
        records: 4,
        files: Object.keys(pages),
      },
    }),
    { readPage: async (file) => pages[file] ?? [] },
  )
  assert.ok(report.issues.some((i) => i.code === 'duplicate_id' && i.message.includes('2')))
})

test('deep check flags record count mismatch', async () => {
  const pages: Record<string, unknown[]> = { 'invoices/page-000001.json': [{ Id: '1' }] }
  const report = await validateSnapshot(
    manifest({
      accounts: { status: 'completed' },
      invoices: { status: 'completed', entity: 'Invoice', pages: 1, records: 9, files: ['invoices/page-000001.json'] },
    }),
    { readPage: async (file) => pages[file] ?? [] },
  )
  assert.ok(report.issues.some((i) => i.code === 'count_mismatch'))
})

test('clean snapshot with completed required resources passes', async () => {
  const pages: Record<string, unknown[]> = {
    'accounts/page-000001.json': [{ Id: 'a1' }],
    'invoices/page-000001.json': [{ Id: 'i1' }, { Id: 'i2' }],
  }
  const report = await validateSnapshot(
    manifest({
      accounts: { status: 'completed', entity: 'Account', pages: 1, records: 1, files: ['accounts/page-000001.json'] },
      invoices: { status: 'completed', entity: 'Invoice', pages: 1, records: 2, files: ['invoices/page-000001.json'] },
    }),
    { readPage: async (file) => pages[file] ?? [] },
  )
  assert.equal(report.ok, true, JSON.stringify(report.issues))
})
