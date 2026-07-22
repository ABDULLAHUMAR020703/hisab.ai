/**
 * Format and parse document sequence numbers.
 * Sequence values must be ordinary positive integers — never timestamps, UUIDs, or IDs.
 */

/** Hard cap for accounting document sequences (9 digits). Rejects Unix ms timestamps (~1.7e12). */
export const MAX_DOCUMENT_SEQUENCE_NUMBER = 999_999_999
export const MAX_SEQUENCE_DIGITS = 9

/**
 * Format a document number from sequence parts.
 * Padding 0 → no zero-padding (INV-91). Padding 6 → INV-000091.
 */
export function formatDocumentNumber(input: {
  prefix: string
  number: number
  padding: number
  suffix?: string
}): string {
  const prefix = String(input.prefix ?? '')
  const suffix = String(input.suffix ?? '')
  const n = Math.trunc(Number(input.number))
  if (!isPlausibleSequenceNumber(n)) {
    throw new Error('Document number must be a positive integer within the allowed range')
  }
  const padding = Math.trunc(Number(input.padding ?? 0))
  const body =
    padding > 0 ? String(n).padStart(Math.min(padding, 10), '0') : String(n)
  return `${prefix}${body}${suffix}`
}

/** True for normal invoice sequence integers (1 … 999,999,999). */
export function isPlausibleSequenceNumber(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_DOCUMENT_SEQUENCE_NUMBER
}

/**
 * Extract the sequential number from an issued document no.
 * When prefix is provided, the number must belong to that prefix.
 * Rejects timestamp-sized and overlong digit runs.
 */
export function extractTrailingSequenceNumber(
  documentNo: string,
  prefix?: string,
): number | null {
  const raw = String(documentNo ?? '').trim()
  if (!raw) return null

  let body = raw
  const normalizedPrefix = prefix?.trim() ?? ''
  if (normalizedPrefix) {
    if (!raw.toUpperCase().startsWith(normalizedPrefix.toUpperCase())) {
      return null
    }
    body = raw.slice(normalizedPrefix.length)
  } else {
    // No prefix: take a trailing run of at most 9 digits (ignore timestamp-length runs).
    if (/\d{10,}\s*$/.test(raw)) return null
    const trail = raw.match(/(\d{1,9})\s*$/)
    if (!trail) return null
    const n = Number(trail[1])
    return isPlausibleSequenceNumber(n) ? n : null
  }

  // Prefer a clean numeric body after the prefix (optional non-digit suffix).
  const match = body.match(/^(\d{1,9})(?:\D.*)?$/)
  if (!match) return null

  const digits = match[1]!
  if (digits.length > MAX_SEQUENCE_DIGITS) return null

  const n = Number(digits)
  return isPlausibleSequenceNumber(n) ? n : null
}

export function previewDocumentNumber(input: {
  prefix: string
  nextNumber: number
  padding: number
  suffix?: string
}): string {
  try {
    return formatDocumentNumber({
      prefix: input.prefix,
      number: input.nextNumber,
      padding: input.padding,
      suffix: input.suffix,
    })
  } catch {
    return ''
  }
}
