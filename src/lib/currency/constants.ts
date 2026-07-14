/** Phase 1 supported primary currencies (ISO 4217). */
export const SUPPORTED_CURRENCIES = [
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'GBP', name: 'British Pound' },
] as const

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code']

export const SUPPORTED_CURRENCY_CODES = SUPPORTED_CURRENCIES.map((c) => c.code)

/** Alias used in transaction forms — Phase 1 allowed currencies per company. */
export const ALLOWED_CURRENCIES = SUPPORTED_CURRENCIES

export const DEFAULT_CURRENCY: SupportedCurrencyCode = 'SAR'

const CURRENCY_SET = new Set<string>(SUPPORTED_CURRENCY_CODES)

export function isSupportedCurrency(code: string): code is SupportedCurrencyCode {
  return CURRENCY_SET.has(code)
}

export function normalizeCurrency(code: string | null | undefined): SupportedCurrencyCode {
  const trimmed = code?.trim().toUpperCase()
  if (trimmed && isSupportedCurrency(trimmed)) return trimmed
  return DEFAULT_CURRENCY
}

/** Registration country options with default primary currency. */
export const REGISTRATION_COUNTRIES = [
  { name: 'Saudi Arabia', defaultCurrency: 'SAR' as const },
  { name: 'Pakistan', defaultCurrency: 'PKR' as const },
  { name: 'United Arab Emirates', defaultCurrency: 'AED' as const },
  { name: 'United Kingdom', defaultCurrency: 'GBP' as const },
  { name: 'United States', defaultCurrency: 'USD' as const },
  { name: 'Other', defaultCurrency: 'USD' as const },
]

export function defaultCurrencyForCountry(country: string | null | undefined): SupportedCurrencyCode {
  const match = REGISTRATION_COUNTRIES.find(
    (entry) => entry.name.toLowerCase() === String(country ?? '').trim().toLowerCase(),
  )
  return match?.defaultCurrency ?? 'USD'
}

export function isSaudiArabia(country: string | null | undefined): boolean {
  return String(country ?? '').trim().toLowerCase() === 'saudi arabia'
}
