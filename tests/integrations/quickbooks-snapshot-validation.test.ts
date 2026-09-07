import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSnapshot } from '../../src/lib/import-export/quickbooks/snapshot/snapshot-validation'
import type {
  SnapshotAttachmentLedgerEntry,
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

// --- attachment ledger integrity (migration 070) ---

const ledgerEntry = (over: Partial<SnapshotAttachmentLedgerEntry>): SnapshotAttachmentLedgerEntry => ({
  attachableId: 'x', entityRef: null, fileName: 'f.pdf', contentType: 'application/pdf', sourceSize: null,
  storagePath: null, status: 'pending', reason: null, capturedBytes: null, checksum: null, ...over,
})

const attManifest = (ledgerRequested = true) =>
  manifest(
    { attachments: { status: 'completed', entity: 'Attachable', records: 2 } },
    { requiredResources: [], requestedResources: ledgerRequested ? ['attachments'] : ['accounts'] },
  )

test('K: COMPLETE-eligible with SKIPPED_BUDGET attachments — no blocking issue', async () => {
  const report = await validateSnapshot(attManifest(), {
    attachmentLedger: [
      ledgerEntry({ attachableId: 'a1', status: 'captured', storagePath: 'attachments/a1/f.pdf', capturedBytes: 10 }),
      ledgerEntry({ attachableId: 'a2', status: 'skipped_budget', reason: 'over budget' }),
    ],
    storageObjectBytes: new Map([['attachments/a1/f.pdf', 10]]),
  })
  assert.equal(report.ok, true, JSON.stringify(report.issues))
})

test('captured attachment with no Storage object → attachment_missing_object, not ok', async () => {
  const report = await validateSnapshot(attManifest(), {
    attachmentLedger: [ledgerEntry({ attachableId: 'a1', status: 'captured', storagePath: 'attachments/a1/f.pdf', capturedBytes: 10 })],
    storageObjectBytes: new Map(),
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'attachment_missing_object'))
})

test('captured attachment size mismatch vs Storage → attachment_size_mismatch, not ok', async () => {
  const report = await validateSnapshot(attManifest(), {
    attachmentLedger: [ledgerEntry({ attachableId: 'a1', status: 'captured', storagePath: 'attachments/a1/f.pdf', capturedBytes: 10 })],
    storageObjectBytes: new Map([['attachments/a1/f.pdf', 999]]),
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'attachment_size_mismatch'))
})

test('a skipped attachment that still references a Storage path → ledger inconsistent', async () => {
  const report = await validateSnapshot(attManifest(), {
    attachmentLedger: [ledgerEntry({ attachableId: 'a1', status: 'skipped_budget', storagePath: 'attachments/a1/f.pdf' })],
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'attachment_ledger_inconsistent'))
})

test('duplicate ledger entries for one attachable → ledger inconsistent', async () => {
  const report = await validateSnapshot(attManifest(), {
    attachmentLedger: [
      ledgerEntry({ attachableId: 'dup', status: 'failed' }),
      ledgerEntry({ attachableId: 'dup', status: 'failed' }),
    ],
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'attachment_ledger_inconsistent'))
})

test('attachment ledger is ignored when attachments was not requested', async () => {
  const report = await validateSnapshot(attManifest(false), {
    attachmentLedger: [ledgerEntry({ attachableId: 'a1', status: 'captured', storagePath: 'x', capturedBytes: 1 })],
    storageObjectBytes: new Map(),
    readPage: async () => [{ Id: 'a1' }],
  })
  assert.ok(!report.issues.some((i) => i.code.startsWith('attachment_')))
})

test('Phase 5: a manifest page reference with no Storage object -> missing_file, not ok', async () => {
  const report = await validateSnapshot(
    manifest({
      accounts: { status: 'completed', entity: 'Account', pages: 1, records: 1, files: ['accounts/page-000001.json'] },
      invoices: { status: 'completed', entity: 'Invoice', pages: 1, records: 1, files: ['invoices/page-000001.json'] },
    }),
    {
      readPage: async () => [{ Id: 'x' }],
      storageObjectBytes: new Map([['accounts/page-000001.json', 50]]), // invoices page absent
    },
  )
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'missing_file' && i.message.includes('invoices/page-000001.json')))
})

test('Phase 5: attachment summary count that disagrees with the ledger -> inconsistent, not ok', async () => {
  const m = manifest(
    { attachments: { status: 'completed', entity: 'Attachable', records: 2 } },
    { requiredResources: [], requestedResources: ['attachments'] },
  )
  m.entities['attachments'].attachmentSummary = {
    metadataRecords: 2, binariesDownloaded: 1, binariesFailed: 0, captured: 1, totalCandidates: 2, capturedBytes: 10,
  }
  const report = await validateSnapshot(m, {
    attachmentLedger: [
      ledgerEntry({ attachableId: 'a1', status: 'captured', storagePath: 'attachments/a1/f.pdf', capturedBytes: 10 }),
      ledgerEntry({ attachableId: 'a2', status: 'captured', storagePath: 'attachments/a2/f.pdf', capturedBytes: 10 }),
    ],
    storageObjectBytes: new Map([['attachments/a1/f.pdf', 10], ['attachments/a2/f.pdf', 10]]),
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.code === 'attachment_ledger_inconsistent' && /summary reports 1 captured but the ledger has 2/.test(i.message)))
})
