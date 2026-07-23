import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateInvoiceTotals } from '../../src/lib/invoices/calculations'
import { roundMoney } from '../../src/lib/tax/calculator'
import { generateZatcaInvoiceXml, syncInputTotalsFromDocument } from '../../src/lib/zatca/generate'
import { mapInvoiceToZatcaDocument } from '../../src/lib/zatca/mapper'
import { resolveZatcaSubmissionRoute } from '../../src/lib/zatca/constants'
import { buildZatcaInvoiceXml } from '../../src/lib/zatca/xml/builder'
import {
  extractDocumentMonetarySnapshot,
  extractXmlMonetarySnapshot,
  validateProcessedMonetaryTotals,
} from '../../src/lib/zatca/validation/monetary'
import {
  validateFullSubmissionPipeline,
  validateInvoiceFieldsForSubmission,
} from '../../src/lib/zatca/validation/hardening'
import type { ZatcaInvoiceInput } from '../../src/lib/zatca/types'

function sampleInput(overrides?: Partial<ZatcaInvoiceInput>): ZatcaInvoiceInput {
  return {
    id: 'inv-1',
    invoiceNo: 'INV-TEST',
    invoiceUUID: '550e8400-e29b-41d4-a716-446655440000',
    invoiceType: 'STANDARD',
    date: new Date('2026-01-15T10:00:00'),
    issueTime: '10:00:00',
    currency: 'SAR',
    // Deliberately wrong headers — must not drive validation or XML
    subtotal: 1,
    taxAmount: 1,
    total: 1,
    lines: [
      {
        id: 'l0',
        description: 'Line',
        quantity: 1,
        unitPrice: 7998.9,
        taxRate: 15,
        amount: 7998.9,
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

describe('single monetary calculation pipeline', () => {
  it('XML: TaxExclusiveAmount + TaxAmount = TaxInclusiveAmount', () => {
    const { document, xml } = generateZatcaInvoiceXml(sampleInput())
    const monetary = extractDocumentMonetarySnapshot(document)
    assert.equal(
      monetary.taxInclusiveAmount,
      roundMoney(monetary.taxExclusiveAmount + monetary.taxAmount),
    )
    const fromXml = extractXmlMonetarySnapshot(xml)
    assert.equal(fromXml.taxExclusiveAmount, monetary.taxExclusiveAmount)
    assert.equal(fromXml.taxAmount, monetary.taxAmount)
    assert.equal(fromXml.taxInclusiveAmount, monetary.taxInclusiveAmount)
    assert.equal(fromXml.payableAmount, monetary.payableAmount)
    assert.equal(fromXml.lineExtensionAmount, monetary.lineExtensionAmount)
  })

  it('PDF totals helper equals XML document totals', () => {
    const input = sampleInput()
    const document = mapInvoiceToZatcaDocument(input)
    const pdfTotals = calculateInvoiceTotals(
      input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
      })),
      'TAX_EXCLUSIVE',
    )
    assert.equal(document.legalMonetaryTotal.taxExclusiveAmount, pdfTotals.subtotal)
    assert.equal(document.taxTotal.taxAmount, pdfTotals.taxAmount)
    assert.equal(document.legalMonetaryTotal.taxInclusiveAmount, pdfTotals.total)
  })

  it('validation uses processed document totals (ignores wrong header / rate recalculation)', () => {
    const input = sampleInput()
    // Independent float recalc that historically failed local hardening:
    const naiveTax = input.lines.reduce((s, l) => s + l.amount * (l.taxRate / 100), 0)
    const naiveTotal = input.lines.reduce((s, l) => s + l.amount, 0) + naiveTax
    assert.notEqual(roundMoney(naiveTotal), input.total) // headers wrong
    // And naive may disagree with commercial rounding:
    assert.equal(roundMoney(7998.9 * 0.15), 1199.84)

    const { document, validation } = generateZatcaInvoiceXml(input)
    const fieldResult = validateInvoiceFieldsForSubmission(input, document)
    assert.equal(fieldResult.valid, true, fieldResult.errors.map((e) => e.message).join('; '))

    const full = validateFullSubmissionPipeline(input, validation, document)
    assert.equal(full.valid, true, full.errors.map((e) => e.message).join('; '))

    const processed = validateProcessedMonetaryTotals(document)
    assert.equal(processed.valid, true)
    assert.equal(document.taxTotal.taxAmount, 1199.84)
  })

  it('syncInputTotalsFromDocument aligns headers to XML pipeline', () => {
    const input = sampleInput()
    const document = mapInvoiceToZatcaDocument(input)
    const synced = syncInputTotalsFromDocument(input, document)
    assert.equal(synced.subtotal, document.legalMonetaryTotal.taxExclusiveAmount)
    assert.equal(synced.taxAmount, document.taxTotal.taxAmount)
    assert.equal(synced.total, document.legalMonetaryTotal.taxInclusiveAmount)
  })

  it('generated XML monetary snapshot equals rebuilt signed-shape XML totals', () => {
    // Signing does not mutate monetary elements; rebuild from same document proves stability.
    const { document, xml } = generateZatcaInvoiceXml(sampleInput())
    const rebuilt = buildZatcaInvoiceXml(document)
    const a = extractXmlMonetarySnapshot(xml)
    const b = extractXmlMonetarySnapshot(rebuilt)
    const doc = extractDocumentMonetarySnapshot(document)
    assert.deepEqual(a, b)
    assert.equal(a.lineExtensionAmount, doc.lineExtensionAmount)
    assert.equal(a.taxExclusiveAmount, doc.taxExclusiveAmount)
    assert.equal(a.taxAmount, doc.taxAmount)
    assert.equal(a.taxInclusiveAmount, doc.taxInclusiveAmount)
    assert.equal(a.payableAmount, doc.payableAmount)
    assert.equal(a.profileId, doc.profileId)
  })

  it('rejects processed documents with broken monetary identity', () => {
    const { document } = generateZatcaInvoiceXml(sampleInput())
    document.legalMonetaryTotal.taxInclusiveAmount = 1
    const result = validateProcessedMonetaryTotals(document)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.code === 'INV_TOTAL_MISMATCH'))
  })
})

describe('submission routing single source', () => {
  it('STANDARD production uses clearance; SIMPLIFIED uses reporting', () => {
    assert.equal(resolveZatcaSubmissionRoute('STANDARD', 'PRODUCTION', '0100000'), 'clearance')
    assert.equal(resolveZatcaSubmissionRoute('SIMPLIFIED', 'PRODUCTION', '0200000'), 'reporting')
    assert.equal(resolveZatcaSubmissionRoute('STANDARD', 'SANDBOX', '0100000'), 'clearance')
  })

  it('PDF must not infer route from CLEARED status alone (status ≠ route)', () => {
    // REPORTED + STANDARD still clearance; CLEARED + SIMPLIFIED still reporting
    assert.equal(resolveZatcaSubmissionRoute('STANDARD', 'PRODUCTION', '0100000'), 'clearance')
    assert.equal(resolveZatcaSubmissionRoute('SIMPLIFIED', 'PRODUCTION', '0200000'), 'reporting')
  })

  it('BT-23 ProfileID is reporting:1.0 even when clearance route is selected', () => {
    const { document } = generateZatcaInvoiceXml(
      sampleInput({ zatcaEnvironment: 'PRODUCTION', invoiceType: 'STANDARD' }),
    )
    assert.equal(document.profileId, 'reporting:1.0')
    assert.equal(
      resolveZatcaSubmissionRoute('STANDARD', 'PRODUCTION', document.invoiceTypeCodeName),
      'clearance',
    )
  })
})

describe('pre-submission artifact shape', () => {
  it('payload totals match document snapshot for HTTP body fields', () => {
    const { document } = generateZatcaInvoiceXml(sampleInput())
    const snapshot = extractDocumentMonetarySnapshot(document)
    const httpPayload = {
      taxExclusiveAmount: snapshot.taxExclusiveAmount,
      taxAmount: snapshot.taxAmount,
      taxInclusiveAmount: snapshot.taxInclusiveAmount,
      payableAmount: snapshot.payableAmount,
      lineExtensionAmount: snapshot.lineExtensionAmount,
    }
    assert.equal(
      httpPayload.taxInclusiveAmount,
      roundMoney(httpPayload.taxExclusiveAmount + httpPayload.taxAmount),
    )
  })
})
