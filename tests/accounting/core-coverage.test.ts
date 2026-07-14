import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toCanonicalAccountType } from '../../src/lib/accounting/account-type-map'
import { isDebitNormal, signedBalance } from '../../src/lib/accounting/normal-balance'
import { validateBalanced, PostingValidationError } from '../../src/lib/accounting/validation-rules'
import { buildReportCacheKey, invalidateReportCache } from '../../src/lib/accounting/report-cache'

const CANONICAL_TYPES = [
  'Asset', 'Liability', 'Equity', 'Income', 'Expense', 'CostOfGoodsSold',
] as const

const QB_TYPES = [
  'Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset',
  'Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability',
  'Equity', 'Income', 'Other Income', 'Cost of Goods Sold', 'Expense', 'Other Expense',
]

describe('accounting engine core coverage', () => {
  describe('account type mapping', () => {
    for (const qbType of QB_TYPES) {
      it(`maps ${qbType} to a canonical type`, () => {
        const canonical = toCanonicalAccountType(qbType)
        assert.ok((CANONICAL_TYPES as readonly string[]).includes(canonical))
      })
    }
  })

  describe('normal balance rules', () => {
    it('assets and expenses are debit-normal', () => {
      assert.equal(isDebitNormal('Asset'), true)
      assert.equal(isDebitNormal('Expense'), true)
      assert.equal(isDebitNormal('CostOfGoodsSold'), true)
    })

    it('liabilities, equity, income are credit-normal', () => {
      assert.equal(isDebitNormal('Liability'), false)
      assert.equal(isDebitNormal('Equity'), false)
      assert.equal(isDebitNormal('Income'), false)
    })
  })

  describe('double-entry invariants', () => {
    it('multi-line compound entry balances', () => {
      assert.doesNotThrow(() => validateBalanced([
        { accountId: 'cash', debit: 500, credit: 0 },
        { accountId: 'ar', debit: 0, credit: 300 },
        { accountId: 'revenue', debit: 0, credit: 200 },
      ]))
    })

    it('rejects single-sided entries', () => {
      assert.throws(
        () => validateBalanced([{ accountId: 'a', debit: 100, credit: 0 }]),
        PostingValidationError,
      )
    })
  })

  describe('signed balance math', () => {
    it('produces correct trial balance signs', () => {
      const assetBalance = signedBalance(10000, 2500, 'DEBIT')
      const liabilityBalance = signedBalance(500, 8000, 'CREDIT')
      assert.equal(assetBalance, 7500)
      assert.equal(liabilityBalance, 7500)
    })
  })

  describe('report cache isolation', () => {
    it('scopes cache keys by company', () => {
      const k1 = buildReportCacheKey('pl', 'company-a', { from: '2026-01-01' })
      const k2 = buildReportCacheKey('pl', 'company-b', { from: '2026-01-01' })
      assert.notEqual(k1, k2)
      invalidateReportCache('company-a')
    })
  })
})
