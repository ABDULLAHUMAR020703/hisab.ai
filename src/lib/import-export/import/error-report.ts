import type { ImportRowError } from '../types'
import { serializeCsv } from '../parsers/csv-parser'
import { serializeExcel } from '../parsers/excel-parser'

export function buildErrorReport(
  format: 'csv' | 'xlsx',
  errors: ImportRowError[],
): { content: string | ArrayBuffer; mimeType: string; extension: string } {
  const headers = ['Row', 'Field', 'Error Code', 'Message', 'Status', 'Dependency', 'Detail', 'Hint', 'Constraint', 'Table', 'Column']
  const rows = errors.map((error) => ({
    Row: error.rowNumber,
    Field: error.fieldKey ?? '',
    'Error Code': error.errorCode,
    Message: error.message,
    Status:error.details?.status??'',
    Dependency:error.details?.dependency??'',
    Detail:error.details?.detail??'',
    Hint:error.details?.hint??'',
    Constraint:error.details?.constraint??'',
    Table:error.details?.table??'',
    Column:error.details?.column??'',
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
