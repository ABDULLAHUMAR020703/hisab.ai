import * as XLSX from 'xlsx'
import type { ParsedFile } from '../types'
import { sanitizeExportCell } from '../security/sanitize-cell'

export function parseExcel(buffer: ArrayBuffer): ParsedFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { headers: [], rows: [], format: 'xlsx' }
  }

  const sheet = workbook.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })

  if (matrix.length < 1) {
    return { headers: [], rows: [], format: 'xlsx' }
  }

  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
  const rows = matrix.slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])),
    )

  return { headers, rows, format: 'xlsx' }
}

export function serializeExcel(
  headers: string[],
  rows: Array<Record<string, string | number | boolean | null>>,
  sheetName = 'Export',
): ArrayBuffer {
  const data = [
    headers,
    ...rows.map((row) => headers.map((header) => sanitizeExportCell(row[header] ?? ''))),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
