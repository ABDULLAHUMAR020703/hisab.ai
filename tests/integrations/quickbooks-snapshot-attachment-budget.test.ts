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

const { computeAttachmentBudget, attachmentFitsBudget, sanitizeQuotaBytes, sanitizeReserveBytes, DEFAULT_STORAGE_QUOTA_BYTES, DEFAULT_RESERVED_SAFETY_BYTES } = requireModule(
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

test('Phase 4: computeAttachmentBudget collapses unsafe inputs to 0', () => {
  assert.equal(computeAttachmentBudget({ quotaBytes: 0, currentUsageBytes: 0, reservedSafetyBytes: 0 }), 0)
  assert.equal(computeAttachmentBudget({ quotaBytes: -1, currentUsageBytes: 0, reservedSafetyBytes: 0 }), 0)
  // reserve >= quota -> nothing available
  assert.equal(computeAttachmentBudget({ quotaBytes: 100, currentUsageBytes: 0, reservedSafetyBytes: 100 }), 0)
  assert.equal(computeAttachmentBudget({ quotaBytes: 100, currentUsageBytes: 0, reservedSafetyBytes: 500 }), 0)
  // negative usage/reserve are clamped, never inflate the budget
  assert.equal(
    computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: -5_000_000, reservedSafetyBytes: RESERVE }),
    QUOTA - RESERVE,
  )
  assert.equal(computeAttachmentBudget({ quotaBytes: QUOTA, currentUsageBytes: 0, reservedSafetyBytes: -1 }), QUOTA)
  assert.equal(computeAttachmentBudget({ quotaBytes: NaN, currentUsageBytes: 0, reservedSafetyBytes: 0 }), 0)
})

test('Phase 4: sanitizeQuotaBytes rejects non-positive / non-integer overrides', () => {
  assert.equal(sanitizeQuotaBytes(undefined), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes(''), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes('0'), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes('-5'), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes('not-a-number'), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes('1.5'), DEFAULT_STORAGE_QUOTA_BYTES)
  assert.equal(sanitizeQuotaBytes('5000000000'), 5_000_000_000) // a valid override IS honoured
})

test('Phase 4: sanitizeReserveBytes rejects negative or >= quota; buffer can never be configured away', () => {
  assert.equal(sanitizeReserveBytes(undefined, 1_000_000_000), DEFAULT_RESERVED_SAFETY_BYTES)
  assert.equal(sanitizeReserveBytes('-1', 1_000_000_000), DEFAULT_RESERVED_SAFETY_BYTES)
  assert.equal(sanitizeReserveBytes('1000000000', 1_000_000_000), DEFAULT_RESERVED_SAFETY_BYTES, 'reserve == quota rejected')
  assert.equal(sanitizeReserveBytes('999999999999', 1_000_000_000), DEFAULT_RESERVED_SAFETY_BYTES, 'reserve > quota rejected')
  assert.equal(sanitizeReserveBytes('bad', 1_000_000_000), DEFAULT_RESERVED_SAFETY_BYTES)
  assert.equal(sanitizeReserveBytes('200000000', 1_000_000_000), 200_000_000) // valid override honoured
  // A tiny (unrealistic) quota still keeps a reserve strictly below it.
  assert.ok(sanitizeReserveBytes(undefined, 100) < 100)
})

test('Phase 4: production defaults are the safe values', () => {
  assert.equal(DEFAULT_STORAGE_QUOTA_BYTES, 1_000_000_000)
  assert.equal(DEFAULT_RESERVED_SAFETY_BYTES, 170_000_000)
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
