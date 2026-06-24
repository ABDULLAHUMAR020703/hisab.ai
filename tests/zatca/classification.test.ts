import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifySalesInvoiceType,
  isValidSaudiVatTrn,
  resolveZatcaInvoiceType,
} from '../../src/lib/zatca/classification'

describe('ZATCA invoice classification', () => {
  it('treats valid buyer VAT TRN as STANDARD', () => {
    assert.equal(isValidSaudiVatTrn('399999999900003'), true)
    assert.equal(classifySalesInvoiceType({ taxId: '399999999900003' }), 'STANDARD')
  })

  it('treats empty buyer VAT as SIMPLIFIED (B2C)', () => {
    assert.equal(classifySalesInvoiceType({ taxId: '' }), 'SIMPLIFIED')
    assert.equal(classifySalesInvoiceType({ taxId: null }), 'SIMPLIFIED')
    assert.equal(classifySalesInvoiceType({ taxId: '   ' }), 'SIMPLIFIED')
  })

  it('treats invalid TRN format as SIMPLIFIED', () => {
    assert.equal(classifySalesInvoiceType({ taxId: '123456789012345' }), 'SIMPLIFIED')
  })

  it('reclassifies stored STANDARD sales invoices without buyer VAT', () => {
    assert.equal(
      resolveZatcaInvoiceType('STANDARD', { taxId: '' }),
      'SIMPLIFIED',
    )
  })

  it('preserves credit and debit note types', () => {
    assert.equal(resolveZatcaInvoiceType('CREDIT_NOTE', { taxId: '' }), 'CREDIT_NOTE')
    assert.equal(resolveZatcaInvoiceType('DEBIT_NOTE', { taxId: '' }), 'DEBIT_NOTE')
  })
})
