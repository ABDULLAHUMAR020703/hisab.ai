export const PAYMENT_TERM_PRESETS = [
  { key: 'DUE_ON_RECEIPT', label: 'Due on Receipt', days: 0 },
  { key: 'NET_15', label: 'Net 15', days: 15 },
  { key: 'NET_30', label: 'Net 30', days: 30 },
  { key: 'NET_60', label: 'Net 60', days: 60 },
] as const

export type PaymentTermPresetKey = (typeof PAYMENT_TERM_PRESETS)[number]['key'] | 'OTHER'

/**
 * Parse free-text payment terms into day offset.
 * Supports: "Net 30", "net30", "Due on Receipt", "Upon Receipt", "COD", "Due on receipt".
 * Returns null when the text cannot be interpreted.
 */
export function parsePaymentTermsDays(text: string | null | undefined): number | null {
  if (!text?.trim()) return null
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')

  if (
    /due on receipt/.test(normalized) ||
    /upon receipt/.test(normalized) ||
    normalized === 'cod' ||
    normalized === 'cash on delivery' ||
    normalized === 'due immediately'
  ) {
    return 0
  }

  const netMatch = normalized.match(/\bnet\s*[-:]?\s*(\d+)\b/)
  if (netMatch) {
    return Number(netMatch[1])
  }

  const daysMatch = normalized.match(/\b(\d+)\s*days?\b/)
  if (daysMatch) {
    return Number(daysMatch[1])
  }

  for (const preset of PAYMENT_TERM_PRESETS) {
    if (normalized === preset.label.toLowerCase()) {
      return preset.days
    }
  }

  return null
}

export function resolvePaymentTermDays(options: {
  paymentTermDays?: number | null
  termsText?: string | null
  presetKey?: string | null
}): number {
  if (options.presetKey && options.presetKey !== 'OTHER') {
    const preset = PAYMENT_TERM_PRESETS.find((p) => p.key === options.presetKey)
    if (preset) return preset.days
  }

  if (options.paymentTermDays != null && Number.isFinite(options.paymentTermDays)) {
    return Math.max(0, Math.floor(Number(options.paymentTermDays)))
  }

  const parsed = parsePaymentTermsDays(options.termsText)
  if (parsed != null) return parsed

  return 30
}

/** Add calendar days to a date (local / UTC-safe via Date math). */
export function computeDueDate(invoiceDate: Date | string, days: number): Date {
  const base = typeof invoiceDate === 'string' ? new Date(invoiceDate) : new Date(invoiceDate)
  const result = new Date(base)
  result.setUTCDate(result.getUTCDate() + Math.max(0, Math.floor(days)))
  return result
}

/** Format YYYY-MM-DD for date inputs. */
export function toDateInputValue(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function matchPresetFromTerms(termsText: string | null | undefined): PaymentTermPresetKey {
  const days = parsePaymentTermsDays(termsText)
  if (days === 0 && termsText && /receipt|cod/i.test(termsText)) return 'DUE_ON_RECEIPT'
  if (days === 15) return 'NET_15'
  if (days === 30) return 'NET_30'
  if (days === 60) return 'NET_60'
  if (days === 0) return 'DUE_ON_RECEIPT'
  return 'OTHER'
}
