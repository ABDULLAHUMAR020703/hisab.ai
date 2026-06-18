import 'server-only'
import PDFDocument from 'pdfkit'
import type { CompanySettings, Customer, Invoice, InvoiceLine } from '@prisma/client'
import { resolveInvoiceQrForPdf } from './qr-for-pdf'

type InvoiceWithRelations = Invoice & {
  customer: Customer
  lines: InvoiceLine[]
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-SA', {
    style: 'currency',
    currency: currency || 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPdfDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function invoiceTypeLabel(type: string): string {
  switch (type) {
    case 'SIMPLIFIED':
      return 'Simplified Tax Invoice'
    case 'CREDIT_NOTE':
      return 'Credit Note'
    case 'DEBIT_NOTE':
      return 'Debit Note'
    default:
      return 'Tax Invoice'
  }
}

function buildCompanyAddress(settings: CompanySettings): string {
  const parts = [
    settings.buildingNumber,
    settings.streetAddress || settings.address,
    settings.district,
    settings.city,
    settings.postalCode,
    settings.country,
  ].filter(Boolean)
  return parts.join(', ')
}

function buildCustomerAddress(customer: Customer): string {
  const parts = [
    customer.buildingNumber,
    customer.streetAddress || customer.address,
    customer.district,
    customer.city,
    customer.postalCode,
    customer.country,
  ].filter(Boolean)
  return parts.join(', ')
}

export async function generateInvoicePdf(
  invoice: InvoiceWithRelations,
  settings: CompanySettings,
): Promise<Buffer> {
  const qr = await resolveInvoiceQrForPdf(invoice.id)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const left = doc.page.margins.left
    let y = doc.page.margins.top

    const companyTitle = settings.legalName || settings.companyName
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#1e293b')
    doc.text(companyTitle, left, y, { width: pageWidth - 120 })
    y = doc.y + 4

    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
    if (settings.companyName !== companyTitle) {
      doc.text(settings.companyName, left, y)
      y = doc.y + 2
    }

    const address = buildCompanyAddress(settings)
    if (address) {
      doc.text(address, left, y, { width: pageWidth - 120 })
      y = doc.y + 2
    }
    if (settings.taxId) {
      doc.text(`VAT TRN: ${settings.taxId}`, left, y)
      y = doc.y + 2
    }
    if (settings.commercialRegistration) {
      doc.text(`CR: ${settings.commercialRegistration}`, left, y)
      y = doc.y + 2
    }
    if (settings.phone) {
      doc.text(`Tel: ${settings.phone}`, left, y)
      y = doc.y + 2
    }
    if (settings.email) {
      doc.text(settings.email, left, y)
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#4f46e5')
    doc.text(invoiceTypeLabel(invoice.invoiceType), left + pageWidth - 180, doc.page.margins.top, {
      width: 180,
      align: 'right',
    })

    y = Math.max(y, doc.page.margins.top + 72) + 24
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor('#e2e8f0').stroke()
    y += 18

    const metaCol = pageWidth / 2 - 12
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#94a3b8')
    doc.text('INVOICE DETAILS', left, y)
    doc.text('BILL TO', left + metaCol + 24, y)
    y += 14

    doc.font('Helvetica').fontSize(10).fillColor('#334155')
    const detailsStartY = y
    doc.text(`Invoice No: ${invoice.invoiceNo}`, left, y)
    y = doc.y + 4
    doc.text(`Date: ${formatPdfDate(invoice.date)}`, left, y)
    y = doc.y + 4
    doc.text(`Due Date: ${formatPdfDate(invoice.dueDate)}`, left, y)
    y = doc.y + 4
    doc.text(`Status: ${invoice.status}`, left, y)
    if (invoice.invoiceUUID) {
      y = doc.y + 4
      doc.fontSize(8).text(`UUID: ${invoice.invoiceUUID}`, left, y, { width: metaCol })
      doc.fontSize(10)
    }
    if (invoice.zatcaStatus && invoice.zatcaStatus !== 'DRAFT') {
      y = doc.y + 4
      doc.fillColor('#059669').text(`ZATCA: ${invoice.zatcaStatus}`, left, y)
      doc.fillColor('#334155')
    }

    let billY = detailsStartY
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b')
    doc.text(invoice.customer.name, left + metaCol + 24, billY, { width: metaCol })
    billY = doc.y + 4
    doc.font('Helvetica').fontSize(10).fillColor('#334155')
    if (invoice.customer.taxId) {
      doc.text(`VAT TRN: ${invoice.customer.taxId}`, left + metaCol + 24, billY, { width: metaCol })
      billY = doc.y + 4
    }
    const customerAddress = buildCustomerAddress(invoice.customer)
    if (customerAddress) {
      doc.text(customerAddress, left + metaCol + 24, billY, { width: metaCol })
      billY = doc.y + 4
    }
    if (invoice.customer.email) {
      doc.text(invoice.customer.email, left + metaCol + 24, billY, { width: metaCol })
    }

    y = Math.max(y, billY) + 24

    const colWidths = {
      desc: pageWidth * 0.42,
      qty: pageWidth * 0.1,
      price: pageWidth * 0.16,
      tax: pageWidth * 0.1,
      amount: pageWidth * 0.22,
    }

    doc.rect(left, y, pageWidth, 22).fill('#f1f5f9')
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(9)
    let colX = left + 8
    doc.text('Description', colX, y + 7, { width: colWidths.desc - 8 })
    colX += colWidths.desc
    doc.text('Qty', colX, y + 7, { width: colWidths.qty - 4, align: 'right' })
    colX += colWidths.qty
    doc.text('Unit Price', colX, y + 7, { width: colWidths.price - 4, align: 'right' })
    colX += colWidths.price
    doc.text('VAT %', colX, y + 7, { width: colWidths.tax - 4, align: 'right' })
    colX += colWidths.tax
    doc.text('Amount', colX, y + 7, { width: colWidths.amount - 8, align: 'right' })
    y += 28

    doc.font('Helvetica').fontSize(10).fillColor('#334155')
    for (const line of invoice.lines) {
      if (y > doc.page.height - 180) {
        doc.addPage()
        y = doc.page.margins.top
      }

      const lineTax = line.amount * (line.taxRate / 100)
      const lineTotal = line.amount + lineTax
      colX = left + 8
      doc.text(line.description, colX, y, { width: colWidths.desc - 8 })
      colX += colWidths.desc
      doc.text(String(line.quantity), colX, y, { width: colWidths.qty - 4, align: 'right' })
      colX += colWidths.qty
      doc.text(formatMoney(line.unitPrice, invoice.currency), colX, y, { width: colWidths.price - 4, align: 'right' })
      colX += colWidths.price
      doc.text(`${line.taxRate}%`, colX, y, { width: colWidths.tax - 4, align: 'right' })
      colX += colWidths.tax
      doc.text(formatMoney(lineTotal, invoice.currency), colX, y, { width: colWidths.amount - 8, align: 'right' })
      y += 22
      doc.moveTo(left, y - 6).lineTo(left + pageWidth, y - 6).strokeColor('#f1f5f9').stroke()
    }

    y += 12
    const totalsX = left + pageWidth - 220
    const totalsValW = 100

    const addTotalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 11 : 10)
        .fillColor(bold ? '#1e293b' : '#475569')
      doc.text(label, totalsX, y, { width: 110 })
      doc.text(value, totalsX + 110, y, { width: totalsValW, align: 'right' })
      y += bold ? 18 : 16
    }

    addTotalRow('Subtotal', formatMoney(invoice.subtotal, invoice.currency))
    addTotalRow(`VAT`, formatMoney(invoice.taxAmount, invoice.currency))
    doc.moveTo(totalsX, y).lineTo(totalsX + 210, y).strokeColor('#cbd5e1').stroke()
    y += 8
    addTotalRow('Total', formatMoney(invoice.total, invoice.currency), true)
    if (invoice.amountPaid > 0) {
      addTotalRow('Paid', formatMoney(invoice.amountPaid, invoice.currency))
      addTotalRow('Balance Due', formatMoney(invoice.balance, invoice.currency), true)
    }

    if (invoice.notes?.trim()) {
      y += 8
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#94a3b8').text('NOTES', left, y)
      y += 12
      doc.font('Helvetica').fontSize(10).fillColor('#475569').text(invoice.notes.trim(), left, y, { width: pageWidth - 140 })
      y = doc.y + 8
    }

    if (invoice.terms?.trim()) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#94a3b8').text('TERMS', left, y)
      y += 12
      doc.font('Helvetica').fontSize(10).fillColor('#475569').text(invoice.terms.trim(), left, y, { width: pageWidth - 140 })
    }

    const footerY = doc.page.height - doc.page.margins.bottom - (qr ? 130 : 40)
    if (y > footerY - 20) {
      doc.addPage()
    }

    const qrY = doc.page.height - doc.page.margins.bottom - (qr ? 118 : 36)
    doc.moveTo(left, qrY - 12).lineTo(left + pageWidth, qrY - 12).strokeColor('#e2e8f0').stroke()

    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
    doc.text(
      `Generated by hisab.ai · ${formatPdfDate(new Date())}`,
      left,
      qrY,
      { width: pageWidth - (qr ? 130 : 0), align: 'left' },
    )

    if (qr) {
      doc.image(qr.png, left + pageWidth - 108, qrY - 4, { width: 100, height: 100 })
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#059669')
      doc.text(qr.caption, left + pageWidth - 108, qrY + 102, { width: 100, align: 'center' })
    } else if (settings.zatcaEnabled) {
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
      doc.text(
        'ZATCA QR unavailable — check company VAT TRN in Settings.',
        left,
        qrY + 14,
        { width: pageWidth, align: 'right' },
      )
    }

    doc.end()
  })
}
