import type { FileFormat, OfficialImportTemplate } from '../types'
import { serializeCsv } from '../parsers/csv-parser'
import { serializeExcel } from '../parsers/excel-parser'

export function buildOfficialTemplateRows(
  template: OfficialImportTemplate,
): Array<Record<string, string>> {
  const exampleRow: Record<string, string> = {}
  for (const column of template.columns) {
    exampleRow[column.header] = column.example
  }
  return [exampleRow]
}

export function getOfficialTemplateHeaders(template: OfficialImportTemplate): string[] {
  return template.columns.map((column) => column.header)
}

export function serializeOfficialTemplate(
  format: FileFormat,
  template: OfficialImportTemplate,
): { content: string | ArrayBuffer; mimeType: string; extension: string } {
  const headers = getOfficialTemplateHeaders(template)
  const rows = buildOfficialTemplateRows(template)

  if (format === 'csv') {
    return {
      content: serializeCsv(headers, rows),
      mimeType: 'text/csv',
      extension: 'csv',
    }
  }

  return {
    content: serializeExcel(headers, rows, template.name.slice(0, 31)),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  }
}
