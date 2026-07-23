import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import PDFDocument from 'pdfkit'
import { renderSaudiProfessionalInvoice } from '../../src/lib/invoices/pdf/templates/saudi-professional'
import type { InvoicePdfDocument, PdfLineItem } from '../../src/lib/invoices/pdf/types'

function makeLine(index: number, overrides: Partial<PdfLineItem> = {}): PdfLineItem {
  return {
    index,
    itemName: overrides.itemName ?? 'Telecom Services',
    description:
      overrides.description ??
      'Sales Invoice of MW with additional wrapping text for layout validation',
    projectService: overrides.projectService ?? 'Sales',
    className: overrides.className ?? 'MW/WL',
    quantity: overrides.quantity ?? 1,
    unitPrice: overrides.unitPrice ?? 100,
    taxRate: overrides.taxRate ?? 15,
    taxAmount: overrides.taxAmount ?? 15,
    lineTotal: overrides.lineTotal ?? 115,
  }
}

function makeDocument(lineCount: number, longDescription = false): InvoicePdfDocument {
  const lines = Array.from({ length: lineCount }, (_, i) =>
    makeLine(i + 1, {
      description: longDescription
        ? `Line ${i + 1}\nVery long description that wraps across multiple lines to verify row height measurement and pagination do not overlap.\nSecond paragraph of detail for the same line item.`
        : `Sales Invoice of MW #${i + 1}`,
      projectService: i % 2 === 0 ? 'Sales' : 'Operations',
      className: i % 3 === 0 ? 'MW/WL' : 'Construction',
    }),
  )

  return {
    invoiceType: 'STANDARD',
    title: 'TAX INVOICE',
    titleAccent: '#4f46e5',
    invoiceNo: 'INV-LAYOUT-TEST',
    date: new Date('2026-07-01'),
    dueDate: new Date('2026-07-31'),
    expiryDate: null,
    terms: 'Net 30',
    taxCalculationMethod: 'TAX_EXCLUSIVE',
    currency: 'SAR',
    businessStatus: 'SENT',
    zatcaStatusLabel: null,
    referencedInvoiceNo: null,
    customer: {
      name: 'Test Customer',
      address: '123 Street',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      taxId: '300000000000003',
      email: 'a@b.c',
      phone: '0500000000',
    },
    lines,
    subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    taxAmount: lines.reduce((s, l) => s + l.taxAmount, 0),
    total: lines.reduce((s, l) => s + l.lineTotal, 0),
    amountPaid: 0,
    balanceDue: lines.reduce((s, l) => s + l.lineTotal, 0),
    taxSummary: [{ taxRate: 15, taxableAmount: 100 * lineCount, taxAmount: 15 * lineCount }],
    notes: 'Layout regression notes',
    zatcaInfo: null,
    qr: null,
    company: {
      companyName: 'Hisab Test Co',
      legalName: 'Hisab Test Co LLC',
      taxId: '310000000000003',
      commercialRegistration: '1010000000',
      addressLines: ['Riyadh', 'Saudi Arabia'],
      phone: '0110000000',
      email: 'billing@example.com',
      website: null,
      currency: 'SAR',
      logoPng: null,
    },
  }
}

describe('invoice PDF row layout', () => {
  it('measures multi-line description taller than a single-line row', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 })
    doc.font('Helvetica').fontSize(8.5)
    const width = 180
    const shortH = doc.heightOfString('One line', { width, lineGap: 1 })
    const tallH = doc.heightOfString(
      'Telecom Services\nSales Invoice of MW\nProject: Sales\nClass: MW/WL',
      { width, lineGap: 1 },
    )
    assert.ok(tallH > shortH * 2)
  })

  it('renders 1, 10, and 50 multi-line rows without throwing', async () => {
    for (const count of [1, 10, 50]) {
      const pdf = await renderSaudiProfessionalInvoice(makeDocument(count, true))
      assert.ok(pdf.length > 1000, `expected PDF bytes for ${count} lines`)
      assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF')
    }
  })

  it('renders 100+ lines with long descriptions across page breaks', async () => {
    const pdf = await renderSaudiProfessionalInvoice(makeDocument(120, true))
    assert.ok(pdf.length > 5000)
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF')
  })
})
