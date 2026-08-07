/**
 * QuickBooks stores an exchange rate for every currency pair on every date it
 * has ever known, so an unfiltered ExchangeRate query is an open-ended series
 * rather than a finite entity list. Hisab only keeps the current rate per pair,
 * so extraction pins the query to a single as-of date and then reduces whatever
 * comes back to one latest row per pair, which holds even if the provider
 * ignores the predicate.
 */
type JsonRecord = Record<string, unknown>

const CURRENCY_CODE = /^[A-Za-z]{3}$/
const AS_OF_DATE = /^\d{4}-\d{2}-\d{2}$/

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {}
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

export function currentExchangeRateAsOfDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Reads the enabled currency codes from a CompanyCurrency query response. */
export function companyCurrencyCodes(rows: unknown[]): string[] {
  const codes = rows.map((row) => {
    const source = object(row)
    if (source.Active === false) return ''
    return text(source.Code ?? source.CurrencyCode ?? object(source.CurrencyRef).value).toUpperCase()
  })
  return [...new Set(codes.filter((code) => CURRENCY_CODE.test(code)))].sort()
}

/**
 * QuickBooks requires both a source currency and an as-of date to answer an
 * ExchangeRate query; without them it falls back to the historical dump.
 */
export function quickBooksExchangeRateWhere(currencyCodes: string[], asOfDate: string): string | undefined {
  if (!AS_OF_DATE.test(asOfDate)) throw new Error(`Invalid QuickBooks exchange rate as-of date: ${asOfDate}`)
  const codes = [...new Set(currencyCodes.map((code) => text(code).toUpperCase()).filter((code) => CURRENCY_CODE.test(code)))].sort()
  if (!codes.length) return undefined
  return `sourcecurrencycode IN (${codes.map((code) => `'${code}'`).join(', ')}) AND asofdate = '${asOfDate}'`
}

export function exchangeRateCurrencyPair(row: unknown): { from: string; to: string } | null {
  const source = object(row)
  const from = text(source.SourceCurrencyCode ?? object(source.SourceCurrencyRef).value ?? source.FromCurrency).toUpperCase()
  const to = text(source.TargetCurrencyCode ?? object(source.TargetCurrencyRef).value ?? source.ToCurrency).toUpperCase()
  return from && to ? { from, to } : null
}

export function exchangeRateAsOfDate(row: unknown): string {
  const source = object(row)
  return text(source.AsOfDate ?? source.EffectiveDate ?? source.Date).slice(0, 10)
}

function exchangeRateUpdatedAt(row: unknown): string {
  return text(object(object(row).MetaData).LastUpdatedTime)
}

/**
 * Keeps the newest row per currency pair, ordered by first appearance so the
 * result is identical for a given input regardless of how pages were fetched.
 * Rows without a resolvable pair are passed through untouched.
 */
export function latestExchangeRateRows(rows: unknown[]): unknown[] {
  const latest = new Map<string, { order: number; row: unknown; asOfDate: string; updatedAt: string }>()
  const unpaired: { order: number; row: unknown }[] = []

  rows.forEach((row, order) => {
    const pair = exchangeRateCurrencyPair(row)
    if (!pair) {
      unpaired.push({ order, row })
      return
    }
    const key = `${pair.from}:${pair.to}`
    const asOfDate = exchangeRateAsOfDate(row)
    const updatedAt = exchangeRateUpdatedAt(row)
    const current = latest.get(key)
    const newer = !current
      || asOfDate > current.asOfDate
      || (asOfDate === current.asOfDate && updatedAt > current.updatedAt)
    if (newer) latest.set(key, { order: current?.order ?? order, row, asOfDate, updatedAt })
  })

  return [...latest.values(), ...unpaired]
    .sort((first, second) => first.order - second.order)
    .map((entry) => entry.row)
}
