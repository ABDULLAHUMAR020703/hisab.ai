import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCreditCardPaymentPostingLines, buildRefundPostingLines, buildTaxSettlementPostingLines, postingTotals } from '../../src/lib/product-parity/accounting'
import { calculateBillableMargin, calculateRefund, ProductParityValidationError } from '../../src/lib/product-parity/validation'

test('refund totals use line-level tax and four-decimal accounting precision', () => {
  const result = calculateRefund([
    { description: 'Returned service', quantity: 2, unitPrice: 100.125, taxRate: 15 },
    { description: 'Adjustment', quantity: 1, unitPrice: 10, taxRate: 0 },
  ])
  assert.deepEqual(result, { lines: result.lines, subtotal: 210.25, taxAmount: 30.0375, total: 240.2875 })
})

test('refund validation rejects missing lines, non-positive quantity and invalid tax', () => {
  assert.throws(() => calculateRefund([]), ProductParityValidationError)
  assert.throws(() => calculateRefund([{ description: 'x', quantity: 0, unitPrice: 1, taxRate: 0 }]), /greater than zero/)
  assert.throws(() => calculateRefund([{ description: 'x', quantity: 1, unitPrice: 1, taxRate: 101 }]), /cannot exceed 100/)
})

test('refund ledger posting is balanced including tax reversal', () => {
  const totals = postingTotals(buildRefundPostingLines({ revenueLines: [{ accountId: 'revenue', amount: 60 }, { accountId: 'services', amount: 40 }], taxAccountId: 'tax', bankAccountId: 'bank', taxAmount: 15, total: 115, reference: 'RR-1' }))
  assert.deepEqual(totals, { debit: 115, credit: 115 })
})

test('credit-card pay down is balanced and includes fees', () => {
  const lines = buildCreditCardPaymentPostingLines({ cardAccountId: 'card', bankAccountId: 'bank', feeAccountId: 'fees', amount: 500, feeAmount: 12.5, reference: 'CCP-1' })
  assert.deepEqual(postingTotals(lines), { debit: 512.5, credit: 512.5 })
  assert.equal(lines.length, 3)
})

test('tax payments and refunds produce opposite balanced postings', () => {
  const payment = buildTaxSettlementPostingLines({ type: 'PAYMENT', taxAccountId: 'tax', bankAccountId: 'bank', amount: 75, reference: 'TAXP-1' })
  const refund = buildTaxSettlementPostingLines({ type: 'REFUND', taxAccountId: 'tax', bankAccountId: 'bank', amount: 75, reference: 'TAXR-1' })
  assert.deepEqual(postingTotals(payment), { debit: 75, credit: 75 })
  assert.deepEqual(postingTotals(refund), { debit: 75, credit: 75 })
  assert.equal(payment[0].accountId, 'tax')
  assert.equal(refund[0].accountId, 'bank')
})

test('billable work reports cost, contribution and margin percent', () => {
  assert.deepEqual(calculateBillableMargin(600, 1000), { cost: 600, billed: 1000, margin: 400, marginPercent: 40 })
  assert.deepEqual(calculateBillableMargin(0, 0), { cost: 0, billed: 0, margin: 0, marginPercent: 0 })
})

test('product-gap schema is additive, tenant isolated, and integrity constrained', () => {
  const sql = readFileSync('supabase/migrations/050_product_parity_gaps.sql', 'utf8')
  for (const table of ['refund_receipts', 'time_activities', 'credit_card_payments', 'tax_agencies', 'customer_types', 'payment_methods']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`))
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /CHECK \(abs\(\(subtotal \+ tax_amount\) - total\) <= 0\.01\)/)
  assert.match(sql, /CHECK \(bank_account_id <> credit_card_account_id\)/)
  assert.match(sql, /CHECK \(\(employee_id IS NOT NULL\)::int \+ \(vendor_id IS NOT NULL\)::int = 1\)/)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|ALTER COLUMN/i)
})
