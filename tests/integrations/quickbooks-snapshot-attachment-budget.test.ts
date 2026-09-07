/**
 * Storage-aware attachment budget: deterministic budget maths + project-wide
 * usage measurement (every bucket, `company-files` included).
 *
 * Run: npm run test:quickbooks-snapshot
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { computeAttachmentBudget, attachmentFitsBudget } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-budget',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-attachment-budget')
const { measureStorageUsageBytes } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-storage-usage',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage-usage')

const QUOTA = 1_000_000_000
const RESERVE = 170_000_000

test('Q: computeAttachmentBudget is deterministic — quota - usage - reserve, floored at 0', () => {
  assert.equal(
    computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 25_000_000, reservedSafetyBytes: RESERVE }),
    805_000_000,
  )
  // Same inputs -> same output, no clock / randomness.
  const a = computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 123_456_789, reservedSafetyBytes: RESERVE })
  const b = computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 123_456_789, reservedSafetyBytes: RESERVE })
  assert.equal(a, b)
})

test('G: existing project storage usage reduces the available attachment budget', () => {
  const empty = computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 0, reservedSafetyBytes: RESERVE })
  const used = computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 300_000_000, reservedSafetyBytes: RESERVE })
  assert.equal(empty, 830_000_000)
  assert.equal(used, 530_000_000)
  assert.equal(empty - used, 300_000_000)
})

test('budget can never be negative — over-quota usage yields 0', () => {
  assert.equal(
    computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 1_200_000_000, reservedSafetyBytes: RESERVE }),
    0,
  )
  assert.equal(
    computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: QUOTA - RESERVE, reservedSafetyBytes: RESERVE }),
    0,
  )
})

test('E/F: attachmentFitsBudget — exact boundary fits, one byte over does not', () => {
  assert.equal(attachmentFitsBudget({ budgetBytes: 100, capturedBytes: 60, sizeBytes: 40 }), true)
  assert.equal(attachmentFitsBudget({ budgetBytes: 100, capturedBytes: 60, sizeBytes: 41 }), false)
  assert.equal(attachmentFitsBudget({ budgetBytes: 100, capturedBytes: 100, sizeBytes: 1 }), false)
  assert.equal(attachmentFitsBudget({ budgetBytes: 0, capturedBytes: 0, sizeBytes: 1 }), false)
})

/** Multi-directory paginated listing across two buckets. */
function fixtureProbe() {
  const store: Record<string, Record<string, { name: string; id: string | null; metadata: { size: number } | null }[]>> = {
    'quickbooks-migration': {
      '': [{ name: 'company-1', id: null, metadata: null }],
      'company-1': [{ name: 'a.json', id: 'o1', metadata: { size: 5_000_000 } }, { name: 'sub', id: null, metadata: null }],
      'company-1/sub': [{ name: 'b.json', id: 'o2', metadata: { size: 2_000_000 } }],
    },
    'company-files': {
      '': [{ name: 'logo.png', id: 'o3', metadata: { size: 40_000 } }],
    },
  }
  return {
    buckets: ['quickbooks-migration', 'company-files'],
    listPage: async (bucket: string, path: string, offset: number) => {
      const rows = store[bucket]?.[path] ?? []
      return rows.slice(offset, offset + 100)
    },
  }
}

test('H: measureStorageUsageBytes sums every bucket (company-files included), recursively', async () => {
  const usage = await measureStorageUsageBytes(fixtureProbe())
  assert.equal(usage.byBucket['quickbooks-migration'].bytes, 7_000_000)
  assert.equal(usage.byBucket['company-files'].bytes, 40_000)
  assert.equal(usage.totalBytes, 7_040_000)
  assert.equal(usage.totalObjects, 3)

  // Feed the measured usage straight into the budget calc — no double counting.
  const budget = computeAttachmentBudget({
    quotaBytes: QUOTA,
    currentUsageBytes: usage.totalBytes,
    reservedSafetyBytes: RESERVE,
  })
  assert.equal(budget, QUOTA - 7_040_000 - RESERVE)
})
