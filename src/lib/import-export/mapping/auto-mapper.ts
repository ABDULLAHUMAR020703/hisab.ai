import type { ColumnMapping, FieldDefinition } from '../types'
import { getSynonymsForField } from './synonyms'
import { normalizeHeader } from './normalize-header'

export function validateMappingConflicts(mapping: ColumnMapping): string | null {
  const targetToSource = new Map<string, string>()
  for (const [source, target] of Object.entries(mapping)) {
    if (!target) continue
    const existing = targetToSource.get(target)
    if (existing && existing !== source) {
      return `Multiple columns map to "${target}": "${existing}" and "${source}"`
    }
    targetToSource.set(target, source)
  }
  return null
}

export function validateRequiredMapping(
  mapping: ColumnMapping,
  fields: FieldDefinition[],
): string | null {
  const mappedTargets = new Set(Object.values(mapping).filter(Boolean))
  const missing = fields
    .filter((field) => field.importable !== false && field.required)
    .filter((field) => !mappedTargets.has(field.key))
  if (missing.length === 0) return null
  return `Required fields not mapped: ${missing.map((field) => field.label).join(', ')}`
}

export function autoMapColumns(
  headers: string[],
  fields: FieldDefinition[],
): ColumnMapping {
  const importableFields = fields.filter((field) => field.importable !== false)
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }))

  const mapping: ColumnMapping = {}
  const usedFields = new Set<string>()

  for (const header of headers) {
    mapping[header] = null
  }

  for (const field of importableFields) {
    const synonyms = getSynonymsForField(field.key).map(normalizeHeader)
    const match = normalizedHeaders.find(
      (header) =>
        !usedFields.has(field.key) &&
        (synonyms.includes(header.normalized) ||
          header.normalized === normalizeHeader(field.label)),
    )

    if (match) {
      mapping[match.original] = field.key
      usedFields.add(field.key)
    }
  }

  return mapping
}

export function applyColumnMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): Array<{ rowNumber: number; source: Record<string, string>; mapped: Record<string, unknown> }> {
  return rows.map((row, index) => {
    const mapped: Record<string, unknown> = {}
    for (const [sourceHeader, targetField] of Object.entries(mapping)) {
      if (!targetField) continue
      const value = row[sourceHeader]
      if (value !== undefined) {
        mapped[targetField] = value
      }
    }
    return { rowNumber: index + 1, source: row, mapped }
  })
}

export function mappingSnapshot(mapping: ColumnMapping): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const [source, target] of Object.entries(mapping)) {
    if (target) snapshot[target] = source
  }
  return snapshot
}
