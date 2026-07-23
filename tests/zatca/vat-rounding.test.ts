import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateExclusiveTax, roundHalfUp, roundMoney } from '../../src/lib/tax/calculator'
import { calculateInvoiceLine, calculateInvoiceTotals } from '../../src/lib/invoices/calculations'
import { mapInvoiceToZatcaDocument } from '../../src/lib/zatca/mapper'
import { buildZatcaInvoiceXml } from '../../src/lib/zatca/xml/builder'
import type { ZatcaInvoiceInput } from '../../src/lib/zatca/types'

describe('commercial VAT rounding (half up)', () => {
  it('rounds 1199.835 to 1199.84 (not banker / float truncation to 1199.83)', () => {
    assert.equal(roundHalfUp(1199.835, 2), 1199.84)
    assert.equal(roundMoney(7998.9 * 0.15), 1199.84)
    assert.equal(calculateExclusiveTax(7998.9, 15), 1199.84)
  })

  it('matches PDF line calc for the reported midpoint case', () => {
    const line = calculateInvoiceLine(
      { quantity: 1, unitPrice: 7998.9, taxRate: 15 },
      'TAX_EXCLUSIVE',
    )
    assert.equal(line.amount, 7998.9)
    assert.equal(line.taxAmount, 1199.84)
    assert.equal(line.lineTotal, 9198.74)
  })
})

describe('ZATCA BT-112 consistency', () => {
  function sampleInput(lines: Array<{ amount: number; taxRate: number; unitPrice?: number }>): ZatcaInvoiceInput {
    return {
      id: 'inv-1',
      invoiceNo: 'INV-TEST',
      invoiceType: 'STANDARD',
      date: new Date('2026-01-15T10:00:00'),
      currency: 'SAR',
      // Deliberately wrong header totals — mapper must ignore these for XML monetarys
      subtotal: 1,
      taxAmount: 127368.24,
      total: 1,
      lines: lines.map((l, i) => ({
        id: `l${i}`,
        description: `Line ${i + 1}`,
        quantity: 1,
        unitPrice: l.unitPrice ?? l.amount,
        taxRate: l.taxRate,
        amount: l.amount,
      })),
      customer: {
        name: 'Customer',
        taxId: '300000000000003',
        city: 'Riyadh',
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
    }
  }

  it('keeps TaxTotal === TaxSubtotal === sum(line VAT)', () => {
    const input = sampleInput([
      { amount: 1000, taxRate: 15 },
      { amount: 7998.9, taxRate: 15 },
      { amount: 849121.57 - 1000 - 7998.9, taxRate: 15 },
    ])

    const document = mapInvoiceToZatcaDocument(input)
    const lineTaxSum = roundMoney(
      document.invoiceLines.reduce((s, l) => s + l.taxAmount, 0),
    )
    const subtotalTaxSum = roundMoney(
      document.taxTotal.subtotals.reduce((s, t) => s + t.taxAmount, 0),
    )

    assert.equal(document.taxTotal.taxAmount, lineTaxSum)
    assert.equal(document.taxTotal.taxAmount, subtotalTaxSum)
    assert.equal(
      document.legalMonetaryTotal.taxInclusiveAmount,
      roundMoney(
        document.legalMonetaryTotal.taxExclusiveAmount + document.taxTotal.taxAmount,
      ),
    )

    const line13 = document.invoiceLines.find((l) => l.lineExtensionAmount === 7998.9)
    assert.ok(line13)
    assert.equal(line13!.taxAmount, 1199.84)
    assert.equal(roundMoney(line13!.lineExtensionAmount + line13!.taxAmount), 9198.74)

    const xml = buildZatcaInvoiceXml(document)
    assert.match(xml, /<cbc:TaxAmount currencyID="SAR">1199\.84<\/cbc:TaxAmount>/)
    // Both TaxTotal blocks use the same amount as subtotal
    const taxAmounts = [...xml.matchAll(/<cac:TaxTotal>\s*<cbc:TaxAmount currencyID="SAR">([\d.]+)<\/cbc:TaxAmount>/g)]
    assert.ok(taxAmounts.length >= 2)
    assert.equal(taxAmounts[0][1], taxAmounts[1][1])
    assert.equal(Number(taxAmounts[0][1]), document.taxTotal.taxAmount)
  })

  it('invoice totals helper agrees with mapper for exclusive invoices', () => {
    const lines = [
      { quantity: 1, unitPrice: 1000, taxRate: 15 },
      { quantity: 1, unitPrice: 7998.9, taxRate: 15 },
    ]
    const totals = calculateInvoiceTotals(lines, 'TAX_EXCLUSIVE')
    const document = mapInvoiceToZatcaDocument(
      sampleInput(lines.map((l) => ({ amount: l.unitPrice * l.quantity, taxRate: l.taxRate }))),
    )
    assert.equal(document.taxTotal.taxAmount, totals.taxAmount)
    assert.equal(document.legalMonetaryTotal.taxExclusiveAmount, totals.subtotal)
    assert.equal(document.legalMonetaryTotal.taxInclusiveAmount, totals.total)
  })
})
