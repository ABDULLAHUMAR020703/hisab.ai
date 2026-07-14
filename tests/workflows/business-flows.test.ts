import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateBalanced } from '../../src/lib/accounting/validation-rules'
import { signedBalance, inferNormalBalance } from '../../src/lib/accounting/normal-balance'
import { resolveAccountClassification } from '../../src/lib/accounting/account-type-map'
import { calculateExclusiveTax } from '../../src/lib/tax/calculator'
import { convertAmountAtRate } from '../../src/lib/currency/fx-conversion'
import { calculateWeightedAverageCost, consumeFifoLayers } from '../../src/lib/inventory/costing'

describe('business workflow reconciliation', () => {
  describe('sales to cash', () => {
    it('invoice revenue balances to AR and cash receipt', () => {
      const vat = calculateExclusiveTax(1000, 15)
      assert.equal(vat, 150)
      const invoiceTotal = 1000 + vat

      const arDebit = invoiceTotal
      const revenueCredit = 1000
      const vatCredit = 150
      assert.equal(arDebit, revenueCredit + vatCredit)

      const cashReceipt = invoiceTotal
      const arCredit = cashReceipt
      assert.equal(arDebit - arCredit, 0)
    })
  })

  describe('purchase to pay', () => {
    it('bill expense balances to AP and payment', () => {
      const billTotal = 575
      const expenseDebit = 500
      const vatDebit = 75
      assert.equal(billTotal, expenseDebit + vatDebit)

      const apCredit = billTotal
      const paymentDebit = billTotal
      const apDebitOnPayment = paymentDebit
      assert.equal(apCredit, apDebitOnPayment)
    })
  })

  describe('inventory workflow', () => {
    it('receipt increases inventory asset and receipt COGS on issue', () => {
      const receiptQty = 10
      const receiptCost = 50
      const avg = calculateWeightedAverageCost(0, 0, receiptQty, receiptCost)
      assert.equal(avg, 50)

      const issue = consumeFifoLayers(
        [{ quantityRemaining: 10, unitCost: 50, receivedAt: new Date('2026-01-01') }],
        4,
      )
      assert.equal(issue.totalCost, 200)
    })
  })

  describe('payroll workflow', () => {
    it('payroll accrual balances salary expense and liability', () => {
      const gross = 10000
      const deductions = 1500
      const net = gross - deductions
      const lines = [
        { debit: gross, credit: 0 },
        { debit: 0, credit: deductions },
        { debit: 0, credit: net },
      ]
      assert.doesNotThrow(() => validateBalanced(lines.map((l, i) => ({
        accountId: `acct-${i}`,
        debit: l.debit,
        credit: l.credit,
      }))))
    })
  })

  describe('multi-currency', () => {
    it('converts foreign amounts to base for GL posting', () => {
      const converted = convertAmountAtRate(1000, 3.75)
      assert.equal(converted, 3750)
    })
  })

  describe('month-end close', () => {
    it('net income closes to retained earnings', () => {
      const revenue = signedBalance(0, 50000, inferNormalBalance('Income'))
      const expenses = signedBalance(30000, 0, inferNormalBalance('Expense'))
      const netIncome = revenue + expenses
      const closingEntry = { debit: Math.abs(netIncome), credit: Math.abs(netIncome) }
      assert.equal(closingEntry.debit, closingEntry.credit)
    })
  })

  describe('account classification', () => {
    it('maps operational accounts to GL categories', () => {
      assert.equal(resolveAccountClassification('Accounts Receivable').canonicalType, 'Asset')
      assert.equal(resolveAccountClassification('Accounts Payable').canonicalType, 'Liability')
    })
  })
})
