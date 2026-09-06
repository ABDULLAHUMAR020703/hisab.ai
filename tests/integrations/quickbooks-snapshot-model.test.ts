import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSnapshotStatus,
  isSnapshotConsumable,
  parseSnapshotPageFileName,
  snapshotPageFileName,
} from '../../src/lib/import-export/quickbooks/snapshot/snapshot-model'

const req = ['accounts', 'customers', 'invoices']

function entities(map: Record<string, string>) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { status: v as never }]))
}

test('RUNNING while any required resource is not terminal', () => {
  assert.equal(
    computeSnapshotStatus(entities({ accounts: 'completed', customers: 'running', invoices: 'pending' }), req),
    'RUNNING',
  )
})

test('COMPLETE only when every required resource completed', () => {
  assert.equal(
    computeSnapshotStatus(entities({ accounts: 'completed', customers: 'completed', invoices: 'completed' }), req),
    'COMPLETE',
  )
})

test('a failed required resource can never be COMPLETE (PARTIAL when some completed)', () => {
  assert.equal(
    computeSnapshotStatus(entities({ accounts: 'completed', customers: 'completed', invoices: 'failed' }), req),
    'PARTIAL',
  )
})

test('an unsupported required resource can never be COMPLETE', () => {
  const status = computeSnapshotStatus(
    entities({ accounts: 'completed', customers: 'completed', invoices: 'unsupported' }),
    req,
  )
  assert.notEqual(status, 'COMPLETE')
  assert.equal(status, 'PARTIAL')
})

test('FAILED when every required resource is terminal and none completed', () => {
  assert.equal(
    computeSnapshotStatus(entities({ accounts: 'failed', customers: 'unsupported', invoices: 'failed' }), req),
    'FAILED',
  )
})

test('a failed OPTIONAL resource forces PARTIAL but does not block on required', () => {
  assert.equal(
    computeSnapshotStatus(
      entities({ accounts: 'completed', customers: 'completed', invoices: 'completed', classes: 'failed' }),
      req,
    ),
    'PARTIAL',
  )
})

test('an unsupported OPTIONAL resource still allows COMPLETE', () => {
  assert.equal(
    computeSnapshotStatus(
      entities({ accounts: 'completed', customers: 'completed', invoices: 'completed', classes: 'unsupported' }),
      req,
    ),
    'COMPLETE',
  )
})

test('only COMPLETE snapshots are consumable by migration', () => {
  assert.equal(isSnapshotConsumable('COMPLETE'), true)
  for (const status of ['RUNNING', 'PARTIAL', 'FAILED'] as const) {
    assert.equal(isSnapshotConsumable(status), false)
  }
})

test('page file names round-trip, including size-split parts', () => {
  assert.equal(snapshotPageFileName(7), 'page-000007.json')
  assert.equal(snapshotPageFileName(7, 1), 'page-000007.json')
  assert.equal(snapshotPageFileName(7, 2), 'page-000007-part-02.json')
  assert.deepEqual(parseSnapshotPageFileName('page-000007.json'), { page: 7, part: 1 })
  assert.deepEqual(parseSnapshotPageFileName('page-000007-part-03.json'), { page: 7, part: 3 })
  assert.equal(parseSnapshotPageFileName('manifest.json'), null)
})
