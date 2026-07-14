import type { FieldDefinition, FileFormat } from '../types'
import { serializeCsv } from '../parsers/csv-parser'
import { serializeExcel } from '../parsers/excel-parser'

export function getExportHeaders(fields: FieldDefinition[]): string[] {
  return [...fields]
    .filter((field) => field.exportable !== false)
    .sort((a, b) => (a.exportOrder ?? 99) - (b.exportOrder ?? 99))
    .map((field) => field.key)
}

export function getExportLabels(fields: FieldDefinition[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.exportable !== false)
      .map((field) => [field.key, field.label]),
  )
}

export function buildTemplateRows(fields: FieldDefinition[]): Array<Record<string, string>> {
  const headers = getExportHeaders(fields)
  const sample: Record<string, string> = {}
  for (const header of headers) {
    const field = fields.find((item) => item.key === header)
    switch (field?.type) {
      case 'email':
        sample[header] = 'customer@example.com'
        break
      case 'phone':
        sample[header] = '+966500000000'
        break
      case 'number':
        sample[header] = '30'
        break
      case 'currency':
        sample[header] = '0'
        break
      case 'boolean':
        sample[header] = 'true'
        break
      case 'date':
        sample[header] = '2026-01-15'
        break
      case 'vat':
        sample[header] = '300000000000003'
        break
      default:
        sample[header] = field?.label ?? header
    }
  }
  return [sample]
}

export function serializeExport(
  format: FileFormat,
  headers: string[],
  rows: Array<Record<string, string | number | boolean | null>>,
  labels?: Record<string, string>,
): { content: string | ArrayBuffer; mimeType: string; extension: string } {
  const labelHeaders = headers.map((header) => labels?.[header] ?? header)

  if (format === 'csv') {
    const labeledRows = rows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [labelHeaders[index], row[header] ?? ''])),
    )
    return {
      content: serializeCsv(labelHeaders, labeledRows),
      mimeType: 'text/csv',
      extension: 'csv',
    }
  }

  const labeledRows = rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [labelHeaders[index], row[header] ?? ''])),
  )

  return {
    content: serializeExcel(labelHeaders, labeledRows),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  }
}
