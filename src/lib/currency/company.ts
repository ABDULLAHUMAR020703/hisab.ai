import 'server-only'
import { getSettingsRepository } from '@/lib/db/provider'
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrency } from './constants'

/** Resolves the authenticated tenant's primary currency from company settings. */
export async function getCompanyPrimaryCurrency(): Promise<string> {
  const settings = await getSettingsRepository().findFirst()
  return normalizeCurrency(settings?.currency ?? DEFAULT_CURRENCY)
}

/** Picks a supported transaction currency, falling back to the company primary currency. */
export async function resolveTransactionCurrency(requested?: string | null): Promise<string> {
  const primary = await getCompanyPrimaryCurrency()
  const trimmed = requested?.trim().toUpperCase()
  if (trimmed && isSupportedCurrency(trimmed)) return trimmed
  return primary
}
