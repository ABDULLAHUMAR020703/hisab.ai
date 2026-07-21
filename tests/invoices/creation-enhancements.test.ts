import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateInvoiceLine,
  calculateInvoiceTotals,
  isValidTaxCalculationMethod,
} from '../../src/lib/invoices/calculations'
import {
  computeDueDate,
  matchPresetFromTerms,
  parsePaymentTermsDays,
  resolvePaymentTermDays,
  toDateInputValue,
} from '../../src/lib/invoices/payment-terms'
import {
  validateExpiryDate,
  validateInvoiceAttachmentUpload,
  validateTaxConfigurationInput,
  validateTaxPercentage,
} from '../../src/lib/invoices/validation'

describe('invoice tax calculations', () => {
  it('calculates tax exclusive correctly', () => {
    const line = calculateInvoiceLine(
      { quantity: 1, unitPrice: 100, taxRate: 15 },
      'TAX_EXCLUSIVE',
    )
    assert.equal(line.amount, 100)
    assert.equal(line.taxAmount, 15)
    assert.equal(line.lineTotal, 115)

    const totals = calculateInvoiceTotals(
      [
        { quantity: 2, unitPrice: 50, taxRate: 15 },
        { quantity: 1, unitPrice: 100, taxRate: 15 },
      ],
      'TAX_EXCLUSIVE',
    )
    assert.equal(totals.subtotal, 200)
    assert.equal(totals.taxAmount, 30)
    assert.equal(totals.total, 230)
  })

  it('calculates tax inclusive backwards correctly', () => {
    const line = calculateInvoiceLine(
      { quantity: 1, unitPrice: 115, taxRate: 15 },
      'TAX_INCLUSIVE',
    )
    assert.equal(line.amount, 100)
    assert.equal(line.taxAmount, 15)
    assert.equal(line.lineTotal, 115)

    const totals = calculateInvoiceTotals(
      [{ quantity: 1, unitPrice: 115, taxRate: 15 }],
      'TAX_INCLUSIVE',
    )
    assert.equal(totals.subtotal, 100)
    assert.equal(totals.taxAmount, 15)
    assert.equal(totals.total, 115)
  })

  it('applies zero tax for out of scope', () => {
    const line = calculateInvoiceLine(
      { quantity: 3, unitPrice: 40, taxRate: 15 },
      'OUT_OF_SCOPE',
    )
    assert.equal(line.taxRate, 0)
    assert.equal(line.taxAmount, 0)
    assert.equal(line.amount, 120)
    assert.equal(line.lineTotal, 120)

    const totals = calculateInvoiceTotals(
      [{ quantity: 3, unitPrice: 40, taxRate: 15 }],
      'OUT_OF_SCOPE',
    )
    assert.equal(totals.taxAmount, 0)
    assert.equal(totals.total, 120)
  })

  it('validates tax calculation method values', () => {
    assert.equal(isValidTaxCalculationMethod('TAX_EXCLUSIVE'), true)
    assert.equal(isValidTaxCalculationMethod('TAX_INCLUSIVE'), true)
    assert.equal(isValidTaxCalculationMethod('OUT_OF_SCOPE'), true)
    assert.equal(isValidTaxCalculationMethod('EXCLUSIVE'), false)
  })
})

describe('payment terms due date', () => {
  it('parses common payment term text', () => {
    assert.equal(parsePaymentTermsDays('Net 30'), 30)
    assert.equal(parsePaymentTermsDays('net15'), 15)
    assert.equal(parsePaymentTermsDays('Net 60'), 60)
    assert.equal(parsePaymentTermsDays('Due on Receipt'), 0)
    assert.equal(parsePaymentTermsDays('upon receipt'), 0)
    assert.equal(parsePaymentTermsDays('COD'), 0)
    assert.equal(parsePaymentTermsDays('45 days'), 45)
    assert.equal(parsePaymentTermsDays('weird terms'), null)
  })

  it('computes due date from invoice date + days', () => {
    const due = computeDueDate('2026-07-21T00:00:00.000Z', 30)
    assert.equal(toDateInputValue(due), '2026-08-20')

    const sameDay = computeDueDate('2026-07-21T00:00:00.000Z', 0)
    assert.equal(toDateInputValue(sameDay), '2026-07-21')
  })

  it('resolves days from presets and text', () => {
    assert.equal(resolvePaymentTermDays({ presetKey: 'NET_15' }), 15)
    assert.equal(resolvePaymentTermDays({ presetKey: 'DUE_ON_RECEIPT' }), 0)
    assert.equal(resolvePaymentTermDays({ termsText: 'Net 45' }), 45)
    assert.equal(resolvePaymentTermDays({ paymentTermDays: 10 }), 10)
    assert.equal(matchPresetFromTerms('Net 30'), 'NET_30')
    assert.equal(matchPresetFromTerms('Due on Receipt'), 'DUE_ON_RECEIPT')
    assert.equal(matchPresetFromTerms('Net 45'), 'OTHER')
  })
})

describe('expiry and tax config validation', () => {
  it('rejects expiry before invoice date', () => {
    assert.equal(validateExpiryDate('2026-07-21', '2026-07-20'), 'Expiry date cannot be before invoice date')
    assert.equal(validateExpiryDate('2026-07-21', '2026-07-21'), null)
    assert.equal(validateExpiryDate('2026-07-21', null), null)
    assert.equal(validateExpiryDate('2026-07-21', ''), null)
  })

  it('validates tax percentage bounds', () => {
    assert.equal(validateTaxPercentage(0), null)
    assert.equal(validateTaxPercentage(15), null)
    assert.equal(validateTaxPercentage(100), null)
    assert.match(validateTaxPercentage(-1) ?? '', /between 0 and 100/)
    assert.match(validateTaxPercentage(101) ?? '', /between 0 and 100/)
  })

  it('validates tax configuration CRUD fields', () => {
    assert.equal(
      validateTaxConfigurationInput({
        name: 'VAT 15%',
        percentage: 15,
        category: 'VAT',
        zatcaMapping: 'STANDARD_RATED',
      }),
      null,
    )
    assert.equal(
      validateTaxConfigurationInput({ name: '', percentage: 15 }),
      'name is required',
    )
    assert.equal(
      validateTaxConfigurationInput({
        name: 'Bad',
        percentage: 15,
        zatcaMapping: 'INVALID',
      }),
      'Invalid zatcaMapping',
    )
  })
})

describe('attachment upload validation', () => {
  it('accepts allowed document types and rejects oversized files', () => {
    const ok = new File([new Uint8Array([1, 2, 3])], 'quote.pdf', { type: 'application/pdf' })
    assert.equal(validateInvoiceAttachmentUpload(ok), null)

    const badExt = new File([new Uint8Array([1])], 'hack.exe', {
      type: 'application/octet-stream',
    })
    assert.match(validateInvoiceAttachmentUpload(badExt) ?? '', /not allowed|Unsupported/)

    const huge = new File([new Uint8Array([1])], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 })
    assert.match(validateInvoiceAttachmentUpload(huge) ?? '', /exceeds/)
  })
})
