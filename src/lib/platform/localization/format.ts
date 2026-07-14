export interface LocaleConfig {
  locale: string
  timezone: string
  dateFormat: string
  numberFormat: string
  currencyDisplay: string
}

const DEFAULT_LOCALE: LocaleConfig = {
  locale: 'en-SA',
  timezone: 'Asia/Riyadh',
  dateFormat: 'YYYY-MM-DD',
  numberFormat: '1,234.56',
  currencyDisplay: 'symbol',
}

export function formatDate(value: Date | string, config: Partial<LocaleConfig> = {}): string {
  const locale = config.locale ?? DEFAULT_LOCALE.locale
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString(locale, { timeZone: config.timezone ?? DEFAULT_LOCALE.timezone })
}

export function formatNumber(value: number, config: Partial<LocaleConfig> = {}): string {
  const locale = config.locale ?? DEFAULT_LOCALE.locale
  return value.toLocaleString(locale, { maximumFractionDigits: 2 })
}

export function formatCurrency(
  value: number,
  currency: string,
  config: Partial<LocaleConfig> = {},
): string {
  const locale = config.locale ?? DEFAULT_LOCALE.locale
  const style = config.currencyDisplay === 'code' ? 'code' : 'symbol'
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: style }).format(value)
}

export async function getLocaleSettings(companyId: string): Promise<LocaleConfig> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient()
  const { data } = await client
    .from('locale_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!data) return DEFAULT_LOCALE
  return {
    locale: data.locale,
    timezone: data.timezone,
    dateFormat: data.date_format,
    numberFormat: data.number_format,
    currencyDisplay: data.currency_display,
  }
}

export async function getTranslation(namespace: string, locale: string, key: string): Promise<string | null> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient()
  const { data } = await client
    .from('translations')
    .select('message_value')
    .eq('namespace', namespace)
    .eq('locale', locale)
    .eq('message_key', key)
    .maybeSingle()
  return data?.message_value ?? null
}

export async function upsertTranslation(input: {
  namespace?: string
  locale: string
  key: string
  value: string
}) {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient()
  const { data, error } = await client
    .from('translations')
    .upsert({
      namespace: input.namespace ?? 'app',
      locale: input.locale,
      message_key: input.key,
      message_value: input.value,
    }, { onConflict: 'namespace,locale,message_key' })
    .select('*')
    .single()
  if (error) throw error
  return data
}
