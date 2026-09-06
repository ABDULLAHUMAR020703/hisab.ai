import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { splitBySize, snapshotPrefix, resourcePrefix, manifestPath } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-storage',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage')

test('storage path helpers follow the reused quickbooks-migration convention', () => {
  const prefix = snapshotPrefix('c1', 'r9', 's5')
  assert.equal(prefix, 'c1/quickbooks/r9/snapshots/s5')
  assert.equal(resourcePrefix(prefix, 'invoices'), 'c1/quickbooks/r9/snapshots/s5/invoices')
  assert.equal(manifestPath(prefix), 'c1/quickbooks/r9/snapshots/s5/manifest.json')
})

test('splitBySize keeps a whole small page as one chunk', () => {
  const records = Array.from({ length: 50 }, (_, i) => ({ Id: String(i), name: `row ${i}` }))
  assert.deepEqual(splitBySize(records, 40 * 1024 * 1024), [records])
})

test('splitBySize splits when serialized size exceeds the limit, losing no records', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ Id: String(i), blob: 'x'.repeat(1000) }))
  const chunks = splitBySize(records, 4000)
  assert.ok(chunks.length > 1, 'expected multiple chunks')
  assert.equal(chunks.flat().length, records.length)
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(JSON.stringify(chunk)) <= 4000 || chunk.length === 1)
  }
})

test('splitBySize never drops a single oversized record', () => {
  const records = [{ Id: '1', blob: 'x'.repeat(10_000) }]
  assert.deepEqual(splitBySize(records, 100), [records])
})
