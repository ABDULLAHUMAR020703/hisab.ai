import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveZatcaProfileId,
  resolveZatcaSubmissionRoute,
  ZATCA_DOCUMENT_PROFILE,
} from '../../src/lib/zatca/constants'
import { generateZatcaInvoiceXml } from '../../src/lib/zatca/generate'
import { mapInvoiceToZatcaDocument } from '../../src/lib/zatca/mapper'
import { buildZatcaInvoiceXml } from '../../src/lib/zatca/xml/builder'
import type { ZatcaInvoiceInput } from '../../src/lib/zatca/types'

function baseInput(overrides: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput {
  return {
    id: 'inv-bt23',
    invoiceNo: 'INV-BT23',
    invoiceUUID: '550e8400-e29b-41d4-a716-446655440000',
    invoiceType: 'STANDARD',
    date: new Date('2026-01-15T10:00:00'),
    issueTime: '10:00:00',
    currency: 'SAR',
    subtotal: 1000,
    taxAmount: 150,
    total: 1150,
    lines: [
      {
        id: 'l0',
        description: 'Service',
        quantity: 1,
        unitPrice: 1000,
        taxRate: 15,
        amount: 1000,
      },
    ],
    customer: {
      name: 'Customer',
      taxId: '300000000000003',
      streetAddress: 'Street',
      city: 'Riyadh',
      postalCode: '12345',
      country: 'SA',
    },
    companySettings: {
      companyName: 'Seller',
      legalName: 'Seller LLC',
      taxId: '310000000000003',
      commercialRegistration: '1234567890',
      streetAddress: 'Street',
      buildingNumber: '1234',
      district: 'District',
      city: 'Riyadh',
      postalCode: '12345',
      country: 'SA',
      currency: 'SAR',
    },
    ...overrides,
  }
}

describe('BT-23 ProfileID (BR-KSA-EN16931-01)', () => {
  it('always resolves to reporting:1.0 regardless of env or invoice type', () => {
    assert.equal(ZATCA_DOCUMENT_PROFILE, 'reporting:1.0')
    for (const env of ['SANDBOX', 'PRODUCTION'] as const) {
      assert.equal(resolveZatcaProfileId('STANDARD', env), 'reporting:1.0')
      assert.equal(resolveZatcaProfileId('SIMPLIFIED', env), 'reporting:1.0')
      assert.equal(resolveZatcaProfileId('CREDIT_NOTE', env), 'reporting:1.0')
      assert.equal(resolveZatcaProfileId('DEBIT_NOTE', env), 'reporting:1.0')
    }
  })

  it('STANDARD PRODUCTION XML has reporting:1.0 and type name 0100000', () => {
    const { document, xml } = generateZatcaInvoiceXml(
      baseInput({ invoiceType: 'STANDARD', zatcaEnvironment: 'PRODUCTION' }),
    )
    assert.equal(document.profileId, 'reporting:1.0')
    assert.equal(document.invoiceTypeCode, '388')
    assert.equal(document.invoiceTypeCodeName, '0100000')
    assert.match(xml, /<cbc:ProfileID>reporting:1\.0<\/cbc:ProfileID>/)
    assert.match(xml, /<cbc:InvoiceTypeCode name="0100000">388<\/cbc:InvoiceTypeCode>/)
    assert.doesNotMatch(xml, /clearance:1\.0/)
  })

  it('SIMPLIFIED PRODUCTION XML has reporting:1.0 and type name 0200000', () => {
    const { document, xml } = generateZatcaInvoiceXml(
      baseInput({
        invoiceType: 'SIMPLIFIED',
        zatcaEnvironment: 'PRODUCTION',
        customer: {
          name: 'Walk-in',
          taxId: null,
          streetAddress: 'Street',
          city: 'Riyadh',
          postalCode: '12345',
          country: 'SA',
        },
      }),
    )
    assert.equal(document.profileId, 'reporting:1.0')
    assert.equal(document.invoiceTypeCodeName, '0200000')
    assert.match(xml, /<cbc:ProfileID>reporting:1\.0<\/cbc:ProfileID>/)
    assert.match(xml, /<cbc:InvoiceTypeCode name="0200000">388<\/cbc:InvoiceTypeCode>/)
  })

  it('submission routing is unchanged (ProfileID ≠ endpoint)', () => {
    assert.equal(
      resolveZatcaSubmissionRoute('STANDARD', 'PRODUCTION', '0100000'),
      'clearance',
    )
    assert.equal(
      resolveZatcaSubmissionRoute('SIMPLIFIED', 'PRODUCTION', '0200000'),
      'reporting',
    )
    assert.equal(
      resolveZatcaSubmissionRoute('STANDARD', 'SANDBOX', '0100000'),
      'clearance',
    )
  })

  it('rebuilding XML from the same document keeps ProfileID and type code stable', () => {
    const document = mapInvoiceToZatcaDocument(
      baseInput({ invoiceType: 'STANDARD', zatcaEnvironment: 'PRODUCTION' }),
    )
    const xmlA = buildZatcaInvoiceXml(document)
    const xmlB = buildZatcaInvoiceXml(document)
    assert.equal(xmlA, xmlB)
    assert.match(xmlA, /<cbc:ProfileID>reporting:1\.0<\/cbc:ProfileID>/)
    assert.match(xmlA, /name="0100000"/)
  })
})
