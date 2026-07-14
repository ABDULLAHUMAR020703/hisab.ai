import type { ImportRowError } from '../types'
import { serializeCsv } from '../parsers/csv-parser'
import { serializeExcel } from '../parsers/excel-parser'

export function buildErrorReport(
  format: 'csv' | 'xlsx',
  errors: ImportRowError[],
): { content: string | ArrayBuffer; mimeType: string; extension: string } {
  const headers = ['Row', 'Field', 'Error Code', 'Message']
  const rows = errors.map((error) => ({
    Row: error.rowNumber,
    Field: error.fieldKey ?? '',
    'Error Code': error.errorCode,
    Message: error.message,
  }))

  if (format === 'xlsx') {
    return {
      content: serializeExcel(headers, rows, 'Errors'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    }
  }

  return {
    content: serializeCsv(headers, rows),
    mimeType: 'text/csv',
    extension: 'csv',
  }
}
