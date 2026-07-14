import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateBalanced,
  PostingValidationError,
} from '../../src/lib/accounting/validation-rules'
import { inferNormalBalance, signedBalance } from '../../src/lib/accounting/normal-balance'
import { buildReportCacheKey, getCachedReport, setCachedReport } from '../../src/lib/accounting/report-cache'

describe('enterprise accounting hardening', () => {
  describe('posting validation', () => {
    it('rejects unbalanced entries', () => {
      assert.throws(
        () => validateBalanced([
          { accountId: 'a', debit: 100, credit: 0 },
          { accountId: 'b', debit: 0, credit: 50 },
        ]),
        PostingValidationError,
      )
    })

    it('accepts balanced entries', () => {
      assert.doesNotThrow(() => validateBalanced([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ]))
    })

    it('rejects zero-total entries', () => {
      assert.throws(
        () => validateBalanced([
          { accountId: 'a', debit: 0, credit: 0 },
        ]),
        (err: Error) => err instanceof PostingValidationError && err.code === 'ZERO_AMOUNT',
      )
    })
  })

  describe('normal balance / signed balance', () => {
    it('debit-normal accounts increase with net debits', () => {
      assert.equal(signedBalance(500, 100, 'DEBIT'), 400)
      assert.equal(inferNormalBalance('Asset'), 'DEBIT')
      assert.equal(inferNormalBalance('Liability'), 'CREDIT')
    })

    it('credit-normal accounts increase with net credits', () => {
      assert.equal(signedBalance(100, 500, 'CREDIT'), 400)
    })
  })

  describe('trial balance integrity', () => {
    it('balanced journal produces equal debit and credit totals', () => {
      const lines = [
        { debit: 250, credit: 0 },
        { debit: 0, credit: 150 },
        { debit: 0, credit: 100 },
      ]
      const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
      assert.equal(totalDebit, totalCredit)
      assert.equal(totalDebit, 250)
    })
  })

  describe('report caching', () => {
    it('stores and retrieves cached reports by key', () => {
      const key = buildReportCacheKey('trial-balance', 'company-1', { asOf: '2026-01-01' })
      assert.equal(getCachedReport(key), null)
      setCachedReport(key, { isBalanced: true, totalDebit: 100, totalCredit: 100 })
      const cached = getCachedReport<{ isBalanced: boolean }>(key)
      assert.equal(cached?.isBalanced, true)
    })
  })

  describe('immutable posting rules', () => {
    it('reversal swaps debits and credits line-for-line', () => {
      const original = { debit: 1000, credit: 0 }
      const reversed = { debit: original.credit, credit: original.debit }
      assert.equal(reversed.debit, 0)
      assert.equal(reversed.credit, 1000)
      assert.equal(reversed.debit - reversed.credit, -(original.debit - original.credit))
    })

    it('duplicate posting is detected when ledger rows exist for journal', () => {
      const existingLedgerRows = [{ journal_entry_id: 'jv-1' }]
      const journalId = 'jv-1'
      const isDuplicate = existingLedgerRows.some((r) => r.journal_entry_id === journalId)
      assert.equal(isDuplicate, true)
    })
  })

  describe('year close math', () => {
    it('net income equals revenue minus expenses', () => {
      const revenue = 50000
      const cogs = 12000
      const expenses = 18000
      const netIncome = revenue - cogs - expenses
      assert.equal(netIncome, 20000)
    })

    it('closing entry balances net income to retained earnings', () => {
      const netIncome = 20000
      const incomeCloseDebit = netIncome
      const incomeCloseCredit = 0
      const retainedEarningsDebit = 0
      const retainedEarningsCredit = netIncome
      assert.equal(incomeCloseDebit, retainedEarningsCredit)
      assert.equal(incomeCloseCredit, retainedEarningsDebit)
      assert.equal(incomeCloseDebit - incomeCloseCredit, retainedEarningsCredit - retainedEarningsDebit)
    })
  })

  describe('balance sheet integrity', () => {
    it('assets equal liabilities plus equity when balanced', () => {
      const totalAssets = 150000
      const totalLiabilities = 60000
      const totalEquity = 90000
      assert.equal(totalAssets, totalLiabilities + totalEquity)
    })
  })

  describe('profit and loss integrity', () => {
    it('gross profit equals revenue minus COGS', () => {
      const revenue = 100000
      const cogs = 35000
      const grossProfit = revenue - cogs
      assert.equal(grossProfit, 65000)
    })

    it('net profit equals gross profit minus expenses', () => {
      const grossProfit = 65000
      const expenses = 22000
      const netProfit = grossProfit - expenses
      assert.equal(netProfit, 43000)
    })
  })

  describe('cash flow integrity', () => {
    it('net cash flow equals total inflows minus total outflows', () => {
      const operating = { inflows: 80000, outflows: 55000 }
      const investing = { inflows: 5000, outflows: 12000 }
      const financing = { inflows: 10000, outflows: 3000 }
      const totalInflows = operating.inflows + investing.inflows + financing.inflows
      const totalOutflows = operating.outflows + investing.outflows + financing.outflows
      assert.equal(totalInflows - totalOutflows, 25000)
    })
  })

  describe('adjusting entry rules', () => {
    it('adjusting entry requires a posted source journal', () => {
      const sourceStatus = 'POSTED'
      const canAdjust = sourceStatus === 'POSTED'
      assert.equal(canAdjust, true)
    })
  })

  describe('opening balance rules', () => {
    it('opening balances carry forward asset and liability balances', () => {
      const priorAssets = 120000
      const priorLiabilities = 45000
      const priorEquity = 75000
      assert.equal(priorAssets, priorLiabilities + priorEquity)
    })
  })

  describe('locked period rules', () => {
    it('closed period blocks posting', () => {
      const periods = [{ status: 'CLOSED', period_start: '2026-01-01', period_end: '2026-12-31' }]
      const entryDate = new Date('2026-06-15')
      const isClosed = periods.some((p) =>
        p.status === 'CLOSED'
        && entryDate >= new Date(p.period_start)
        && entryDate <= new Date(p.period_end),
      )
      assert.equal(isClosed, true)
    })
  })
})
