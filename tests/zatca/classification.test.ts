import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifySalesInvoiceType,
  isValidSaudiVatTrn,
  resolveZatcaInvoiceType,
  resolveZatcaInvoiceTypeCodeName,
} from '../../src/lib/zatca/classification'
import { resolveZatcaSubmissionRoute } from '../../src/lib/zatca/constants'

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

  it('derives code name from invoice type for sales invoices', () => {
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({ invoiceType: 'STANDARD' }),
      '0100000',
    )
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({ invoiceType: 'SIMPLIFIED' }),
      '0200000',
    )
  })

  it('derives standard-family code name from referenced standard invoice', () => {
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({
        invoiceType: 'CREDIT_NOTE',
        referencedSourceInvoiceType: 'STANDARD',
        customer: { taxId: '399999999900003' },
      }),
      '0100000',
    )
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({
        invoiceType: 'DEBIT_NOTE',
        referencedSourceInvoiceType: 'STANDARD',
        customer: { taxId: '399999999900003' },
      }),
      '0100000',
    )
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({
        invoiceType: 'CREDIT_NOTE',
        referencedSourceInvoiceType: 'SIMPLIFIED',
      }),
      '0200000',
    )
    assert.equal(
      resolveZatcaInvoiceTypeCodeName({
        invoiceType: 'DEBIT_NOTE',
        referencedSourceInvoiceType: 'SIMPLIFIED',
      }),
      '0200000',
    )
  })

  it('routes standard-family notes to clearance via derived code name', () => {
    const standardCredit = resolveZatcaInvoiceTypeCodeName({
      invoiceType: 'CREDIT_NOTE',
      referencedSourceInvoiceType: 'STANDARD',
      customer: { taxId: '399999999900003' },
    })
    const simplifiedCredit = resolveZatcaInvoiceTypeCodeName({
      invoiceType: 'CREDIT_NOTE',
      referencedSourceInvoiceType: 'SIMPLIFIED',
    })
    assert.equal(resolveZatcaSubmissionRoute('CREDIT_NOTE', 'SANDBOX', standardCredit), 'clearance')
    assert.equal(resolveZatcaSubmissionRoute('DEBIT_NOTE', 'SANDBOX', standardCredit), 'clearance')
    assert.equal(resolveZatcaSubmissionRoute('CREDIT_NOTE', 'SANDBOX', simplifiedCredit), 'reporting')
    assert.equal(resolveZatcaSubmissionRoute('DEBIT_NOTE', 'SANDBOX', simplifiedCredit), 'reporting')
  })
})
