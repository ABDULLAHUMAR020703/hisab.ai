/**
 * Pure attachment-ledger folding: per-status counts, captured-byte totals,
 * coverage %, and AttachableRef -> EntityRef extraction.
 *
 * Run: npm run test:quickbooks-snapshot
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { SnapshotAttachmentLedgerEntry } from '../../src/lib/import-export/quickbooks/snapshot/snapshot-model'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { summariseAttachmentLedger, capturedBytesOf, firstAttachableEntityRef, emptyAttachmentSummary } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-ledger',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-ledger')

const entry = (over: Partial<SnapshotAttachmentLedgerEntry>): SnapshotAttachmentLedgerEntry => ({
  attachableId: 'x', entityRef: null, fileName: 'f', contentType: null, sourceSize: null,
  storagePath: null, status: 'pending', reason: null, capturedBytes: null, checksum: null, ...over,
})

test('summariseAttachmentLedger: counts, captured bytes, coverage %', () => {
  const ledger: SnapshotAttachmentLedgerEntry[] = [
    entry({ attachableId: 'a1', status: 'captured', storagePath: 'attachments/a1/x', capturedBytes: 100 }),
    entry({ attachableId: 'a2', status: 'captured', storagePath: 'attachments/a2/y', capturedBytes: 250 }),
    entry({ attachableId: 'a3', status: 'skipped_budget', reason: 'over budget' }),
    entry({ attachableId: 'a4', status: 'failed', reason: '500' }),
    entry({ attachableId: 'a5', status: 'unavailable', reason: 'no filename' }),
  ]
  const s = summariseAttachmentLedger(ledger, { budgetBytes: 1_000, metadataRecords: 5 })
  assert.equal(s.totalCandidates, 5)
  assert.equal(s.captured, 2)
  assert.equal(s.skippedBudget, 1)
  assert.equal(s.failed, 1)
  assert.equal(s.unavailable, 1)
  assert.equal(s.capturedBytes, 350)
  assert.equal(s.budgetBytes, 1_000)
  assert.equal(s.metadataRecords, 5)
  assert.equal(s.coveragePercent, 40)
  // Legacy aliases kept for pre-070 readers.
  assert.equal(s.binariesDownloaded, 2)
  assert.equal(s.binariesFailed, 1)
})

test('summariseAttachmentLedger: empty ledger -> 100% coverage (nothing to cover)', () => {
  const s = summariseAttachmentLedger([])
  assert.equal(s.coveragePercent, 100)
  assert.equal(s.captured, 0)
  assert.equal(s.totalCandidates, 0)
})

test('capturedBytesOf only sums CAPTURED entries', () => {
  const ledger: SnapshotAttachmentLedgerEntry[] = [
    entry({ status: 'captured', capturedBytes: 10 }),
    entry({ status: 'captured', capturedBytes: 5 }),
    entry({ status: 'skipped_budget', capturedBytes: null }),
    entry({ status: 'failed' }),
  ]
  assert.equal(capturedBytesOf(ledger), 15)
})

test('firstAttachableEntityRef reads the first usable AttachableRef.EntityRef', () => {
  assert.deepEqual(
    firstAttachableEntityRef({
      AttachableRef: [{ EntityRef: { type: 'Invoice', value: '101' } }, { EntityRef: { type: 'Bill', value: '9' } }],
    }),
    { type: 'Invoice', value: '101' },
  )
  assert.deepEqual(
    firstAttachableEntityRef({ AttachableRef: [{ IncludeOnSend: true }, { EntityRef: { value: '7' } }] }),
    { type: '', value: '7' },
  )
  assert.equal(firstAttachableEntityRef({}), null)
  assert.equal(firstAttachableEntityRef({ AttachableRef: [] }), null)
})

test('emptyAttachmentSummary is a valid zero summary', () => {
  const s = emptyAttachmentSummary(3)
  assert.equal(s.metadataRecords, 3)
  assert.equal(s.captured, 0)
  assert.equal(s.coveragePercent, 100)
})
