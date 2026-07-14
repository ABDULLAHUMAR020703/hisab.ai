import type { ColumnMapping, OfficialImportTemplate } from '../types'
import { normalizeHeader } from '../mapping/normalize-header'

export function headersMatchOfficialTemplate(
  uploadedHeaders: string[],
  template: OfficialImportTemplate,
): boolean {
  const expected = template.columns.map((column) => column.header)
  if (uploadedHeaders.length !== expected.length) return false
  return uploadedHeaders.every(
    (header, index) => normalizeHeader(header) === normalizeHeader(expected[index] ?? ''),
  )
}

export function detectOfficialTemplate(
  uploadedHeaders: string[],
  templates: OfficialImportTemplate[] | undefined,
): OfficialImportTemplate | null {
  if (!templates?.length) return null
  for (const template of templates) {
    if (headersMatchOfficialTemplate(uploadedHeaders, template)) {
      return template
    }
  }
  return null
}

export function buildOfficialTemplateMapping(
  uploadedHeaders: string[],
  template: OfficialImportTemplate,
): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const header of uploadedHeaders) {
    mapping[header] = null
  }
  for (let index = 0; index < template.columns.length; index += 1) {
    const column = template.columns[index]
    const uploadedHeader = uploadedHeaders[index]
    if (uploadedHeader && column) {
      mapping[uploadedHeader] = column.fieldKey
    }
  }
  return mapping
}

export function getDefaultOfficialTemplate(
  templates: OfficialImportTemplate[] | undefined,
): OfficialImportTemplate | null {
  if (!templates?.length) return null
  return templates.find((template) => template.id === 'standard') ?? templates[0]
}

export function getOfficialTemplateById(
  templates: OfficialImportTemplate[] | undefined,
  templateId: string | null | undefined,
): OfficialImportTemplate | null {
  if (!templates?.length) return null
  if (templateId) {
    return templates.find((template) => template.id === templateId) ?? null
  }
  return getDefaultOfficialTemplate(templates)
}

export function isOfficialTemplateMappingComplete(
  template: OfficialImportTemplate,
  mapping: ColumnMapping,
): boolean {
  for (const column of template.columns) {
    if (!column.required) continue
    const mapped = Object.entries(mapping).find(
      ([header, fieldKey]) => fieldKey === column.fieldKey
        && normalizeHeader(header) === normalizeHeader(column.header),
    )
    if (!mapped) return false
  }
  return true
}
