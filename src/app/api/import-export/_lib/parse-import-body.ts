import { applyColumnMapping } from '@/lib/import-export/mapping/auto-mapper'
import { validateMappingConflicts } from '@/lib/import-export/mapping/auto-mapper'
import { coerceMappedRows, validateMappedRows } from '@/lib/import-export/validation/validation-engine'
import { FrameworkBadRequestError } from '@/lib/import-export/errors'
import type { ColumnMapping, DuplicateMatch, MappedRow, ModuleDefinition, ValidationResult } from '@/lib/import-export/types'
import { MAX_IMPORT_ROWS } from '@/lib/import-export/types'

export interface ParsedImportBody {
  rows: Record<string, string>[]
  mapping: ColumnMapping
  mappedRows: MappedRow[]
  validation: ValidationResult
  duplicates?: DuplicateMatch[]
  filename: string
  fileFormat: 'csv' | 'xlsx'
}

export function parseRowsFromBody(body: unknown): Record<string, string>[] {
  if (!body || typeof body !== 'object') {
    throw new FrameworkBadRequestError('Invalid request body')
  }
  const record = body as Record<string, unknown>
  const rows = Array.isArray(record.rows) ? record.rows : []
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new FrameworkBadRequestError(`Import exceeds maximum of ${MAX_IMPORT_ROWS} rows`)
  }
  return rows as Record<string, string>[]
}

export function parseMappingFromBody(body: unknown): ColumnMapping {
  if (!body || typeof body !== 'object') {
    throw new FrameworkBadRequestError('Invalid request body')
  }
  const record = body as Record<string, unknown>
  const mapping = record.mapping && typeof record.mapping === 'object'
    ? (record.mapping as ColumnMapping)
    : {}

  const conflict = validateMappingConflicts(mapping)
  if (conflict) {
    throw new FrameworkBadRequestError(conflict)
  }

  return mapping
}

export function parseDuplicatesFromBody(body: unknown): DuplicateMatch[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  if (!Array.isArray(record.duplicates)) return undefined

  return record.duplicates
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const duplicate = item as Record<string, unknown>
      return {
        rowNumber: Number(duplicate.rowNumber),
        existingId: String(duplicate.existingId),
        matchedOn: Array.isArray(duplicate.matchedOn)
          ? duplicate.matchedOn.map(String)
          : [],
      }
    })
    .filter((item) => Number.isFinite(item.rowNumber) && item.existingId)
}

export function parseOfficialTemplateIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const value = (body as Record<string, unknown>).officialTemplateId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function buildMappedImportPayload(
  module: ModuleDefinition,
  body: unknown,
): Omit<ParsedImportBody, 'filename' | 'fileFormat' | 'duplicates'> {
  const rows = parseRowsFromBody(body)
  const mapping = parseMappingFromBody(body)
  const officialTemplateId = parseOfficialTemplateIdFromBody(body)

  let mappedRows = applyColumnMapping(rows, mapping)
  if (officialTemplateId && module.transformOfficialRow) {
    mappedRows = mappedRows.map((row) => ({
      ...row,
      mapped: module.transformOfficialRow!(row.mapped, officialTemplateId),
    }))
  }

  const coercedRows = coerceMappedRows(mappedRows, module.fields)
  const validation = validateMappedRows(coercedRows, module.fields)

  return { rows, mapping, mappedRows: coercedRows, validation }
}

export function parseFilenameFromBody(body: unknown, fallback = 'import.csv'): string {
  if (!body || typeof body !== 'object') return fallback
  const filename = (body as Record<string, unknown>).filename
  return typeof filename === 'string' && filename.trim() ? filename.trim() : fallback
}

export function parseFileFormatFromBody(body: unknown): 'csv' | 'xlsx' {
  if (!body || typeof body !== 'object') return 'csv'
  return (body as Record<string, unknown>).fileFormat === 'xlsx' ? 'xlsx' : 'csv'
}
