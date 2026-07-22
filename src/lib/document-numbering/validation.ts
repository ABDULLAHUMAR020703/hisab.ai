import type { DocumentSequenceUpdateInput } from './types'

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
    }
  }

  let startingNumber: number | undefined
  if (input.startingNumber !== undefined) {
    startingNumber = Number(input.startingNumber)
    if (!Number.isInteger(startingNumber) || startingNumber < 1) {
      errors.push('Starting number must be a positive integer')
    }
  }

  let nextNumber: number | undefined
  if (input.nextNumber !== undefined) {
    nextNumber = Number(input.nextNumber)
    if (!Number.isInteger(nextNumber) || nextNumber < 1) {
      errors.push('Next number must be a positive integer')
    } else if (
      options?.minNextNumber != null &&
      nextNumber < options.minNextNumber
    ) {
      errors.push(
        `Next number cannot be lower than ${options.minNextNumber} (already-issued documents)`,
      )
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
