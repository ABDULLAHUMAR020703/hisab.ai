import 'server-only'
import PDFDocument from 'pdfkit'
import {
  COMPANY_LOGO_PDF_GAP,
  COMPANY_LOGO_PDF_MAX_HEIGHT,
  COMPANY_LOGO_PDF_MAX_WIDTH,
} from '@/lib/branding/constants'
import type { InvoicePdfDocument, PdfCustomerInfo } from '../types'
import { formatMoney, formatPdfDate, formatPdfDateTime } from '../format'

const MARGIN = 42
const FOOTER_RESERVE = 130

function drawCustomerField(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): number {
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#94a3b8').text(label, x, y, { width })
  doc.font('Helvetica').fontSize(10).fillColor('#334155').text(value, x, y + 11, { width })
  return y + 30
}

function drawCustomerSection(
  doc: PDFKit.PDFDocument,
  customer: PdfCustomerInfo,
  left: number,
  y: number,
  width: number,
): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('BILL TO', left, y)
  y += 16

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(customer.name, left, y, { width })
  y = doc.y + 6

  const fields: [string, string | null][] = [
    ['Address', customer.address],
    ['City', customer.city],
    ['Country', customer.country],
    ['VAT TRN', customer.taxId],
    ['TIN', customer.taxId],
    ['Email', customer.email],
    ['Phone', customer.phone],
  ]

  const seen = new Set<string>()
  for (const [label, value] of fields) {
    if (!value?.trim()) continue
    if (label === 'TIN' && customer.taxId) continue
    const key = `${label}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    y = drawCustomerField(doc, label, value.trim(), left, y, width)
  }

  return y + 8
}

const ROW_PAD_Y = 6
const ROW_GAP = 2
const TABLE_HEADER_HEIGHT = 20

function pageContentBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - MARGIN - FOOTER_RESERVE
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > pageContentBottom(doc)) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function buildLineDescriptionText(line: {
  itemName: string | null
  description: string
  projectService: string | null
  className: string | null
}): string {
  const parts = [
    line.itemName?.trim() || null,
    line.description?.trim() || null,
    line.projectService?.trim() ? `Project: ${line.projectService.trim()}` : null,
    line.className?.trim() ? `Class: ${line.className.trim()}` : null,
  ].filter(Boolean) as string[]
  return parts.join('\n') || '—'
}

function measureLineRowHeight(
  doc: PDFKit.PDFDocument,
  line: InvoicePdfDocument['lines'][number],
  cols: Record<string, number>,
): number {
  doc.font('Helvetica').fontSize(8.5)
  const descHeight = doc.heightOfString(buildLineDescriptionText(line), {
    width: Math.max(8, cols.desc - 8),
    lineGap: 1,
  })
  const singleLineHeight = doc.heightOfString('0', { width: Math.max(8, cols.qty - 2) })
  return Math.ceil(Math.max(descHeight, singleLineHeight) + ROW_PAD_Y * 2)
}

type TableCols = {
  num: number
  desc: number
  qty: number
  unit: number
  taxPct: number
  taxAmt: number
  total: number
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  left: number,
  y: number,
  pageWidth: number,
  cols: TableCols,
): number {
  doc.rect(left, y, pageWidth, TABLE_HEADER_HEIGHT).fill('#f1f5f9')
  doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8)
  let colX = left + 4
  const textY = y + 6
  doc.text('#', colX, textY, { width: cols.num - 4 })
  colX += cols.num
  doc.text('Description', colX, textY, { width: cols.desc - 4 })
  colX += cols.desc
  doc.text('Qty', colX, textY, { width: cols.qty - 2, align: 'right' })
  colX += cols.qty
  doc.text('Unit Price', colX, textY, { width: cols.unit - 2, align: 'right' })
  colX += cols.unit
  doc.text('Tax %', colX, textY, { width: cols.taxPct - 2, align: 'right' })
  colX += cols.taxPct
  doc.text('Tax Amount', colX, textY, { width: cols.taxAmt - 2, align: 'right' })
  colX += cols.taxAmt
  doc.text('Line Total', colX, textY, { width: cols.total - 4, align: 'right' })
  return y + TABLE_HEADER_HEIGHT + 4
}

function drawContinuationPageChrome(
  doc: PDFKit.PDFDocument,
  document: InvoicePdfDocument,
  left: number,
  pageWidth: number,
): number {
  let y = MARGIN
  const displayName = document.company.legalName || document.company.companyName
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
  doc.text(displayName, left, y, { width: pageWidth * 0.55 })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(document.titleAccent)
  doc.text(document.title, left + pageWidth * 0.55, y, { width: pageWidth * 0.45, align: 'right' })
  y = Math.max(doc.y, y + 14) + 2
  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
  doc.text(
    `${document.invoiceNo}  ·  ${formatPdfDate(document.date)}  ·  continued`,
    left,
    y,
    { width: pageWidth },
  )
  y = doc.y + 8
  doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor('#cbd5e1').lineWidth(1).stroke()
  return y + 10
}

/**
 * Ensures the full row fits on the current page. Never starts drawing a row
 * that would be split by PDFKit's automatic page break.
 */
function ensureRowSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  rowHeight: number,
  onNewPage: () => number,
): number {
  if (y + rowHeight <= pageContentBottom(doc)) return y
  doc.addPage()
  return onNewPage()
}

export async function renderSaudiProfessionalInvoice(document: InvoicePdfDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width - MARGIN * 2
    const left = MARGIN
    let y = MARGIN

    const headerRightX = left + pageWidth - 200
    const headerLeftWidth = pageWidth - 220
    const displayName = document.company.legalName || document.company.companyName
    let logoRendered = false

    if (document.company.logoPng) {
      const textX = left + COMPANY_LOGO_PDF_MAX_WIDTH + COMPANY_LOGO_PDF_GAP
      const textWidth = headerLeftWidth - COMPANY_LOGO_PDF_MAX_WIDTH - COMPANY_LOGO_PDF_GAP

      try {
        doc.image(document.company.logoPng, left, y, {
          fit: [COMPANY_LOGO_PDF_MAX_WIDTH, COMPANY_LOGO_PDF_MAX_HEIGHT],
        })
        logoRendered = true

        let textY = y
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
        doc.text(displayName, textX, textY, { width: textWidth })
        textY = doc.y + 4
        if (document.company.legalName && document.company.companyName !== document.company.legalName) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b')
          doc.text(document.company.companyName, textX, textY, { width: textWidth })
          textY = doc.y + 2
        }

        doc.font('Helvetica').fontSize(8.5).fillColor('#475569')
        for (const line of document.company.addressLines) {
          doc.text(line, textX, textY, { width: textWidth })
          textY = doc.y + 1
        }
        if (document.company.commercialRegistration) {
          doc.text(`CR: ${document.company.commercialRegistration}`, textX, textY)
          textY = doc.y + 1
        }
        if (document.company.taxId) {
          doc.text(`VAT TRN: ${document.company.taxId}`, textX, textY)
          textY = doc.y + 1
        }
        if (document.company.phone) {
          doc.text(`Tel: ${document.company.phone}`, textX, textY)
          textY = doc.y + 1
        }
        if (document.company.email) {
          doc.text(document.company.email, textX, textY)
          textY = doc.y + 1
        }
        if (document.company.website) {
          doc.text(document.company.website, textX, textY)
          textY = doc.y + 1
        }

        y = Math.max(y + COMPANY_LOGO_PDF_MAX_HEIGHT, textY) + 6
      } catch (error) {
        console.error('[branding] failed to embed logo in PDF:', error)
        logoRendered = false
        y = MARGIN
      }
    }

    if (!logoRendered) {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
      doc.text(displayName, left, y, { width: headerLeftWidth })
      y = doc.y + 4
      if (document.company.legalName && document.company.companyName !== document.company.legalName) {
        doc.font('Helvetica').fontSize(9).fillColor('#64748b')
        doc.text(document.company.companyName, left, y, { width: headerLeftWidth })
        y = doc.y + 2
      }

      doc.font('Helvetica').fontSize(8.5).fillColor('#475569')
      for (const line of document.company.addressLines) {
        doc.text(line, left, y, { width: headerLeftWidth })
        y = doc.y + 1
      }
      if (document.company.commercialRegistration) {
        doc.text(`CR: ${document.company.commercialRegistration}`, left, y)
        y = doc.y + 1
      }
      if (document.company.taxId) {
        doc.text(`VAT TRN: ${document.company.taxId}`, left, y)
        y = doc.y + 1
      }
      if (document.company.phone) {
        doc.text(`Tel: ${document.company.phone}`, left, y)
        y = doc.y + 1
      }
      if (document.company.email) {
        doc.text(document.company.email, left, y)
        y = doc.y + 1
      }
      if (document.company.website) {
        doc.text(document.company.website, left, y)
        y = doc.y + 1
      }
    }

    const headerTop = MARGIN
    doc.font('Helvetica-Bold').fontSize(20).fillColor(document.titleAccent)
    doc.text(document.title, headerRightX, headerTop, { width: 200, align: 'right' })

    let metaY = headerTop + 34
    const metaColW = 96
    const metaGap = 8
    const metaStartX = headerRightX + 200 - metaColW * 2 - metaGap

    const taxMethodLabel =
      document.taxCalculationMethod === 'TAX_INCLUSIVE'
        ? 'Tax Inclusive'
        : document.taxCalculationMethod === 'OUT_OF_SCOPE'
          ? 'Out of Scope'
          : 'Tax Exclusive'
    const metaFields: [string, string][] = [
      ['Invoice Number', document.invoiceNo],
      ['Invoice Date', formatPdfDate(document.date)],
      ['Due Date', formatPdfDate(document.dueDate)],
      ['Expiry Date', document.expiryDate ? formatPdfDate(document.expiryDate) : '—'],
      ['Terms', document.terms?.trim() || '—'],
      ['Tax Method', taxMethodLabel],
      ['Currency', document.currency],
      ['Invoice Status', document.businessStatus],
    ]
    if (document.zatcaStatusLabel) {
      metaFields.push(['ZATCA Status', document.zatcaStatusLabel])
    }

    for (let i = 0; i < metaFields.length; i++) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x = metaStartX + col * (metaColW + metaGap)
      const fieldY = metaY + row * 30
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#94a3b8')
      doc.text(metaFields[i][0], x, fieldY, { width: metaColW })
      doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b')
      doc.text(metaFields[i][1], x, fieldY + 9, { width: metaColW })
    }

    const balanceBoxY = metaY + Math.ceil(metaFields.length / 2) * 30 + 6
    doc.roundedRect(headerRightX + 60, balanceBoxY, 140, 34, 4).fillAndStroke('#f8fafc', '#e2e8f0')
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    doc.text('BALANCE DUE', headerRightX + 68, balanceBoxY + 6, { width: 124, align: 'right' })
    doc.font('Helvetica-Bold').fontSize(13).fillColor(document.titleAccent)
    doc.text(
      formatMoney(document.balanceDue, document.currency),
      headerRightX + 68,
      balanceBoxY + 17,
      { width: 124, align: 'right' },
    )

    y = Math.max(y, balanceBoxY + 44) + 14
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor('#cbd5e1').lineWidth(1).stroke()
    y += 16

    if (document.referencedInvoiceNo) {
      doc.font('Helvetica').fontSize(9).fillColor('#64748b')
      doc.text(`Reference Invoice: ${document.referencedInvoiceNo}`, left, y)
      y = doc.y + 10
    }

    y = drawCustomerSection(doc, document.customer, left, y, pageWidth * 0.55)
    y += 8

    const cols: TableCols = {
      num: 22,
      desc: pageWidth * 0.34,
      qty: 36,
      unit: 58,
      taxPct: 36,
      taxAmt: 58,
      total: 62,
    }
    const tableWidth = Object.values(cols).reduce((a, b) => a + b, 0)
    const scale = pageWidth / tableWidth
    for (const key of Object.keys(cols) as (keyof TableCols)[]) {
      cols[key] = Math.floor(cols[key] * scale)
    }

    const startTableOnPage = (): number => {
      const nextY = ensureSpace(doc, y, TABLE_HEADER_HEIGHT + 30)
      return drawTableHeader(doc, left, nextY, pageWidth, cols)
    }

    y = startTableOnPage()

    const beginContinuationPage = (): number => {
      let nextY = drawContinuationPageChrome(doc, document, left, pageWidth)
      nextY = drawTableHeader(doc, left, nextY, pageWidth, cols)
      return nextY
    }

    for (const line of document.lines) {
      const rowHeight = measureLineRowHeight(doc, line, cols)
      y = ensureRowSpace(doc, y, rowHeight, beginContinuationPage)

      const rowTop = y
      const textTop = rowTop + ROW_PAD_Y

      // Row border around the full measured height
      doc
        .rect(left, rowTop, pageWidth, rowHeight)
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .stroke()

      let colX = left + 4
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155')

      // All cells share the same top Y — never advance Y per column.
      doc.text(String(line.index), colX, textTop, {
        width: cols.num - 4,
        lineBreak: false,
      })
      colX += cols.num

      doc.text(buildLineDescriptionText(line), colX, textTop, {
        width: cols.desc - 8,
        lineGap: 1,
      })
      colX += cols.desc

      doc.text(String(line.quantity), colX, textTop, {
        width: cols.qty - 2,
        align: 'right',
        lineBreak: false,
      })
      colX += cols.qty

      doc.text(formatMoney(line.unitPrice, document.currency), colX, textTop, {
        width: cols.unit - 2,
        align: 'right',
        lineBreak: false,
      })
      colX += cols.unit

      doc.text(`${line.taxRate}%`, colX, textTop, {
        width: cols.taxPct - 2,
        align: 'right',
        lineBreak: false,
      })
      colX += cols.taxPct

      doc.text(formatMoney(line.taxAmount, document.currency), colX, textTop, {
        width: cols.taxAmt - 2,
        align: 'right',
        lineBreak: false,
      })
      colX += cols.taxAmt

      doc.text(formatMoney(line.lineTotal, document.currency), colX, textTop, {
        width: cols.total - 4,
        align: 'right',
        lineBreak: false,
      })

      // Advance exactly once by measured row height (ignore doc.y from wrapped text).
      y = rowTop + rowHeight + ROW_GAP
    }

    y += 10
    y = ensureSpace(doc, y, 120)

    const summaryWidth = pageWidth * 0.48
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('TAX SUMMARY', left, y)
    y += 14

    const taxHeaderY = y
    doc.rect(left, taxHeaderY, summaryWidth, 18).fill('#f8fafc')
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8)
    doc.text('Tax Rate', left + 6, taxHeaderY + 5, { width: 70 })
    doc.text('Taxable Amount', left + 76, taxHeaderY + 5, { width: 90, align: 'right' })
    doc.text('VAT Amount', left + summaryWidth - 86, taxHeaderY + 5, { width: 80, align: 'right' })
    y = taxHeaderY + 20

    doc.font('Helvetica').fontSize(8.5).fillColor('#334155')
    for (const row of document.taxSummary) {
      doc.text(`${row.taxRate}%`, left + 6, y, { width: 70 })
      doc.text(formatMoney(row.taxableAmount, document.currency), left + 76, y, { width: 90, align: 'right' })
      doc.text(formatMoney(row.taxAmount, document.currency), left + summaryWidth - 86, y, { width: 80, align: 'right' })
      y += 16
    }

    const totalsX = left + pageWidth - 210
    let totalsY = taxHeaderY
    const addTotal = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 11 : 9.5)
        .fillColor(bold ? '#0f172a' : '#475569')
      doc.text(label, totalsX, totalsY, { width: 100 })
      doc.text(value, totalsX + 100, totalsY, { width: 110, align: 'right' })
      totalsY += bold ? 18 : 15
    }

    addTotal('Subtotal', formatMoney(document.subtotal, document.currency))
    addTotal('VAT', formatMoney(document.taxAmount, document.currency))
    doc.moveTo(totalsX, totalsY).lineTo(totalsX + 210, totalsY).strokeColor('#cbd5e1').stroke()
    totalsY += 8
    addTotal('Grand Total', formatMoney(document.total, document.currency), true)
    if (document.amountPaid > 0) {
      addTotal('Amount Paid', formatMoney(document.amountPaid, document.currency))
    }
    addTotal('Balance Due', formatMoney(document.balanceDue, document.currency), true)

    y = Math.max(y, totalsY) + 16

    if (document.notes?.trim()) {
      y = ensureSpace(doc, y, 50)
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('NOTES', left, y)
      y += 12
      doc.font('Helvetica').fontSize(9).fillColor('#334155')
      doc.text(document.notes.trim(), left, y, { width: pageWidth - (document.qr ? 120 : 0) })
      y = doc.y + 12
    }

    if (document.zatcaInfo) {
      y = ensureSpace(doc, y, 90)
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('ZATCA SUBMISSION', left, y)
      y += 14

      const rows: [string, string][] = []
      if (document.zatcaInfo.requestId) {
        rows.push(['Request ID', document.zatcaInfo.requestId])
      }
      if (document.zatcaInfo.submissionDate) {
        rows.push(['Submission Date', formatPdfDateTime(document.zatcaInfo.submissionDate)])
      }
      rows.push(['Route', document.zatcaInfo.route])
      rows.push(['Environment', document.zatcaInfo.environment])
      rows.push(['Status', document.zatcaInfo.status])

      const colW = pageWidth / 2 - 8
      for (let i = 0; i < rows.length; i++) {
        const col = i % 2
        const row = Math.floor(i / 2)
        const x = left + col * (colW + 16)
        const fieldY = y + row * 30
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#94a3b8')
        doc.text(rows[i][0], x, fieldY, { width: colW })
        doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b')
        doc.text(rows[i][1], x, fieldY + 9, { width: colW })
      }
      y += Math.ceil(rows.length / 2) * 30 + 8
    }

    const footerBaseY = doc.page.height - MARGIN - (document.qr ? 108 : 36)
    if (y > footerBaseY - 20) {
      doc.addPage()
    }

    const footerY = doc.page.height - MARGIN - (document.qr ? 108 : 36)
    doc.moveTo(left, footerY - 10).lineTo(left + pageWidth, footerY - 10).strokeColor('#e2e8f0').stroke()

    doc.font('Helvetica').fontSize(9).fillColor('#334155')
    doc.text('Thank you for your business.', left, footerY, { width: pageWidth - (document.qr ? 120 : 0) })

    doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
    doc.text(
      'This is a computer-generated tax invoice. ZATCA e-invoicing compliance applies when submitted to the Fatoora platform.',
      left,
      footerY + 14,
      { width: pageWidth - (document.qr ? 120 : 0) },
    )

    if (document.qr) {
      const qrSize = 96
      const qrX = left + pageWidth - qrSize
      doc.image(document.qr.png, qrX, footerY - 4, { width: qrSize, height: qrSize })
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#059669')
      doc.text('Scan to verify', qrX, footerY + qrSize - 2, { width: qrSize, align: 'center' })
    }

    doc.end()
  })
}
