import type { DocumentSequenceUpdateInput } from './types'
import {
  isPlausibleSequenceNumber,
  MAX_DOCUMENT_SEQUENCE_NUMBER,
} from './format'

export const PREFIX_MAX_LENGTH = 20
export const PADDING_MIN = 0
export const PADDING_MAX = 10

export interface DocumentSequenceValidationResult {
  ok: boolean
  errors: string[]
  normalized?: {
    prefix: string
    startingNumber: number
    nextNumber: number
    padding: number
    suffix: string
  }
}

function validatePositiveSequenceField(
  label: string,
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: false, error: `${label} is required` }
  }
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${label} must be a whole number` }
  }
  if (n < 1) {
    return { ok: false, error: `${label} must be a positive integer` }
  }
  if (n > MAX_DOCUMENT_SEQUENCE_NUMBER) {
    return {
      ok: false,
      error: `${label} is too large (max ${MAX_DOCUMENT_SEQUENCE_NUMBER.toLocaleString()}). Timestamps and IDs are not allowed.`,
    }
  }
  if (!isPlausibleSequenceNumber(n)) {
    return { ok: false, error: `${label} is not a valid sequence number` }
  }
  return { ok: true, value: n }
}

export function validateDocumentSequenceUpdate(
  input: DocumentSequenceUpdateInput,
  options?: { minNextNumber?: number },
): DocumentSequenceValidationResult {
  const errors: string[] = []

  const prefix =
    input.prefix !== undefined ? String(input.prefix).trim() : undefined
  if (prefix !== undefined) {
    if (!prefix) errors.push('Prefix is required')
    else if (prefix.length > PREFIX_MAX_LENGTH) {
      errors.push(`Prefix must be at most ${PREFIX_MAX_LENGTH} characters`)
    } else if (/^\d+$/.test(prefix)) {
      errors.push('Prefix cannot be only digits')
    }
  }

  let startingNumber: number | undefined
  if (input.startingNumber !== undefined) {
    const result = validatePositiveSequenceField('Starting number', input.startingNumber)
    if (!result.ok) errors.push(result.error)
    else startingNumber = result.value
  }

  let nextNumber: number | undefined
  if (input.nextNumber !== undefined) {
    const result = validatePositiveSequenceField('Next invoice number', input.nextNumber)
    if (!result.ok) errors.push(result.error)
    else {
      nextNumber = result.value
      const minNext = options?.minNextNumber
      if (minNext != null && isPlausibleSequenceNumber(minNext) && nextNumber < minNext) {
        errors.push(
          `Next invoice number cannot be lower than ${minNext} (already-issued invoices)`,
        )
      }
    }
  }

  let padding: number | undefined
  if (input.padding !== undefined) {
    padding = Number(input.padding)
    if (!Number.isInteger(padding) || padding < PADDING_MIN || padding > PADDING_MAX) {
      errors.push(`Padding must be an integer between ${PADDING_MIN} and ${PADDING_MAX}`)
    }
  }

  const suffix =
    input.suffix !== undefined ? String(input.suffix) : undefined
  if (suffix !== undefined && suffix.length > 20) {
    errors.push('Suffix must be at most 20 characters')
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    normalized: {
      prefix: prefix ?? 'INV-',
      startingNumber: startingNumber ?? 1,
      nextNumber: nextNumber ?? startingNumber ?? 1,
      padding: padding ?? 6,
      suffix: suffix ?? '',
    },
  }
}
