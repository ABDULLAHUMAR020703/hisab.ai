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
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Document number must be a positive integer')
  }
  const padding = Math.trunc(Number(input.padding ?? 0))
  const body =
    padding > 0 ? String(n).padStart(Math.min(padding, 10), '0') : String(n)
  return `${prefix}${body}${suffix}`
}

/** Extract the trailing numeric sequence from an issued document number. */
export function extractTrailingSequenceNumber(
  documentNo: string,
  prefix?: string,
): number | null {
  const raw = String(documentNo ?? '').trim()
  if (!raw) return null

  if (prefix && prefix.length > 0) {
    if (!raw.toUpperCase().startsWith(prefix.toUpperCase())) {
      // Still try trailing digits when prefixes diverge historically
    }
  }

  const match = raw.match(/(\d+)\s*$/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n >= 1 ? n : null
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
