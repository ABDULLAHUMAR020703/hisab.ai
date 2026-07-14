import { z } from 'zod'
import { isSaudiVatTrn } from '@/lib/customers/vat'
import type { FieldDefinition, FieldType, MappedRow, ValidationIssue, ValidationResult } from '../types'

function coerceValue(value: unknown, type: FieldType): unknown {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''

  switch (type) {
    case 'boolean': {
      const lower = trimmed.toLowerCase()
      if (['true', 'yes', 'y', '1', 'active'].includes(lower)) return true
      if (['false', 'no', 'n', '0', 'inactive'].includes(lower)) return false
      return trimmed
    }
    case 'number':
    case 'currency': {
      const normalized = trimmed.replace(/,/g, '')
      const num = Number(normalized)
      return Number.isFinite(num) ? num : trimmed
    }
    case 'date': {
      const date = new Date(trimmed)
      return Number.isNaN(date.getTime()) ? trimmed : date.toISOString().slice(0, 10)
    }
    default:
      return trimmed
  }
}

function buildFieldSchema(field: FieldDefinition): z.ZodTypeAny {
  let schema: z.ZodTypeAny

  switch (field.type) {
    case 'email':
      schema = z.string().email({ message: 'Invalid email address' })
      break
    case 'phone':
      schema = z.string().min(3, { message: 'Invalid phone number' })
      break
    case 'number':
      schema = z.number({ message: 'Invalid number' })
      break
    case 'currency':
      schema = z
        .number({ message: 'Invalid amount' })
        .refine((value) => value >= 0, { message: 'Amount must be zero or positive' })
      break
    case 'date':
      schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Invalid date (use YYYY-MM-DD)' })
      break
    case 'boolean':
      schema = z.boolean({ message: 'Invalid boolean value' })
      break
    case 'vat':
      schema = z.string().min(1)
      break
    default:
      schema = z.string()
  }

  if (!field.required) {
    schema = z.union([z.literal(''), z.null(), z.undefined(), schema]).optional()
  }

  return schema
}

export function coerceMappedRows(
  rows: MappedRow[],
  fields: FieldDefinition[],
): MappedRow[] {
  const fieldMap = new Map(fields.map((field) => [field.key, field]))
  return rows.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row.mapped)) {
      const field = fieldMap.get(key)
      mapped[key] = field ? coerceValue(value, field.type) : value
    }
    return { ...row, mapped }
  })
}

export function validateMappedRows(
  rows: MappedRow[],
  fields: FieldDefinition[],
): ValidationResult {
  const importableFields = fields.filter((field) => field.importable !== false)
  const issues: ValidationIssue[] = []
  const validRowNumbers: number[] = []
  const invalidRowNumbers: number[] = []
  const summaryByCode: Record<string, number> = {}

  const addIssue = (issue: ValidationIssue) => {
    issues.push(issue)
    summaryByCode[issue.code] = (summaryByCode[issue.code] ?? 0) + 1
  }

  for (const row of rows) {
    let hasError = false

    for (const field of importableFields) {
      const rawValue = row.mapped[field.key]
      const isEmpty =
        rawValue === undefined ||
        rawValue === null ||
        (typeof rawValue === 'string' && rawValue.trim() === '')

      if (field.required && isEmpty) {
        hasError = true
        addIssue({
          rowNumber: row.rowNumber,
          fieldKey: field.key,
          code: 'REQUIRED_FIELD',
          message: `${field.label} is required`,
          severity: 'error',
        })
        continue
      }

      if (isEmpty) continue

      const coerced = coerceValue(rawValue, field.type)
      const schema = buildFieldSchema({ ...field, required: true })
      const result = schema.safeParse(coerced)

      if (!result.success) {
        hasError = true
        const message = result.error.issues[0]?.message ?? `Invalid ${field.label}`
        addIssue({
          rowNumber: row.rowNumber,
          fieldKey: field.key,
          code: `INVALID_${field.type.toUpperCase()}`,
          message,
          severity: 'error',
        })
        continue
      }

      if (field.type === 'vat') {
        const vat = String(coerced)
        if (vat && !isSaudiVatTrn(vat)) {
          addIssue({
            rowNumber: row.rowNumber,
            fieldKey: field.key,
            code: 'INVALID_VAT',
            message: 'VAT/TRN must be 15 digits',
            severity: 'warning',
          })
        }
      }
    }

    if (hasError) invalidRowNumbers.push(row.rowNumber)
    else validRowNumbers.push(row.rowNumber)
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  return {
    issues,
    errorCount,
    warningCount,
    validRowNumbers,
    invalidRowNumbers,
    summaryByCode,
  }
}
