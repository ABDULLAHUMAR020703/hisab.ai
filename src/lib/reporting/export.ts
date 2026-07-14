import 'server-only'
import PDFDocument from 'pdfkit'
import { serializeCsv } from '@/lib/import-export/parsers/csv-parser'
import { serializeExcel } from '@/lib/import-export/parsers/excel-parser'
import type { ReportExportFormat, ReportRunResult } from './types'

function extractExportRows(result: ReportRunResult): Array<Record<string, unknown>> {
  if (result.rows?.length) return result.rows
  const data = result.data as Record<string, unknown> | null
  if (!data) return []
  if (Array.isArray(data.rows)) return data.rows as Array<Record<string, unknown>>
  if (Array.isArray(data.details)) return data.details as Array<Record<string, unknown>>
  if (Array.isArray(data.entries)) return data.entries as Array<Record<string, unknown>>
  return [data]
}

function buildPdfBuffer(title: string, meta: string[], headers: string[], stringRows: Array<Record<string, string>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).text(title, { underline: true })
    doc.moveDown(0.5)
    doc.fontSize(10).fillColor('#555')
    for (const line of meta) doc.text(line)
    doc.moveDown()
    doc.fillColor('#000').fontSize(9)

    if (stringRows.length === 0) {
      doc.text('No tabular rows available for this report.')
    } else {
      doc.font('Helvetica-Bold').text(headers.join(' | '), { width: doc.page.width - 80 })
      doc.moveDown(0.3)
      doc.font('Helvetica')
      for (const row of stringRows.slice(0, 500)) {
        doc.text(headers.map((h) => String(row[h] ?? '')).join(' | '), { width: doc.page.width - 80 })
        if (doc.y > doc.page.height - 60) doc.addPage()
      }
      if (stringRows.length > 500) {
        doc.moveDown().text(`… ${stringRows.length - 500} more rows truncated for PDF`)
      }
    }
    doc.end()
  })
}

export async function exportReport(
  result: ReportRunResult,
  format: ReportExportFormat,
): Promise<{ content: string | ArrayBuffer | Uint8Array; mimeType: string; filename: string }> {
  const rows = extractExportRows(result)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ['report']
  const stringRows = rows.map((row) =>
    Object.fromEntries(headers.map((h) => [h, row[h] == null ? '' : String(row[h])])),
  )

  const baseName = `${result.reportKey}-${new Date().toISOString().substring(0, 10)}`

  if (format === 'csv') {
    const content = serializeCsv(headers, stringRows)
    return { content, mimeType: 'text/csv', filename: `${baseName}.csv` }
  }

  if (format === 'xlsx') {
    const content = serializeExcel(headers, stringRows, result.title)
    return { content, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${baseName}.xlsx` }
  }

  if (format === 'pdf' || format === 'print') {
    const meta: string[] = [`Generated: ${result.generatedAt.substring(0, 19)}`]
    if (result.period) meta.unshift(`Period: ${result.period.from.substring(0, 10)} — ${result.period.to.substring(0, 10)}`)
    if (result.asOf) meta.unshift(`As of: ${result.asOf.substring(0, 10)}`)
    const content = await buildPdfBuffer(result.title, meta, headers, stringRows)
    return { content, mimeType: 'application/pdf', filename: `${baseName}.pdf` }
  }

  return {
    content: JSON.stringify(result, null, 2),
    mimeType: 'application/json',
    filename: `${baseName}.json`,
  }
}
