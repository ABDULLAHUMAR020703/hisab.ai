import assert from 'node:assert/strict'
import test from 'node:test'
import { QuickBooksImportAdapter } from '../../src/lib/import-export/sources/quickbooks.adapter'
import {
  companyCurrencyCodes,
  currentExchangeRateAsOfDate,
  latestExchangeRateRows,
  quickBooksExchangeRateWhere,
} from '../../src/lib/import-export/quickbooks/exchange-rates'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import type { AccountingProvider } from '../../src/integrations/accounting/contracts/accounting-provider'

const CONTEXT = { accessToken: 'token', realmId: 'realm-1' }
const CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://test/callback', environment: 'sandbox' as const }

function rate(source: string, target: string, asOfDate: string, value: number, lastUpdatedTime?: string) {
  return {
    SourceCurrencyCode: source,
    TargetCurrencyCode: target,
    Rate: value,
    AsOfDate: asOfDate,
    MetaData: lastUpdatedTime ? { LastUpdatedTime: lastUpdatedTime } : {},
  }
}

/** Adapter driven by a stub fetch so the real provider paginator is exercised. */
function exchangeRateService(currencies: unknown[], pages: unknown[][]) {
  const queries: string[] = []
  const service = new QuickBooksIntegrationService(CREDENTIALS, async (input) => {
    const query = new URL(String(input)).searchParams.get('query') ?? ''
    queries.push(query)
    if (query.includes('FROM CompanyCurrency')) return Response.json({ QueryResponse: { CompanyCurrency: currencies } })
    const startPosition = Number(/STARTPOSITION (\d+)/.exec(query)?.[1] ?? 1)
    const page = pages.shift() ?? []
    return Response.json({ QueryResponse: { ExchangeRate: page, startPosition, maxResults: page.length, totalCount: page.length } })
  })
  return { service: service as unknown as AccountingProvider, queries }
}

test('only the latest rate per currency pair survives reduction', () => {
  const reduced = latestExchangeRateRows([
    rate('EUR', 'USD', '2016-05-18', 1.11),
    rate('GBP', 'USD', '2020-01-01', 1.31),
    rate('EUR', 'USD', '2026-08-06', 1.09),
    rate('EUR', 'USD', '2019-09-19', 1.1),
    rate('GBP', 'USD', '2026-08-06', 1.27),
  ])

  assert.deepEqual(reduced, [
    rate('EUR', 'USD', '2026-08-06', 1.09),
    rate('GBP', 'USD', '2026-08-06', 1.27),
  ])
})

test('reduction is deterministic for equal as-of dates and preserves unpaired rows', () => {
  const withoutPair = { Rate: 3.75, AsOfDate: '2026-08-06' }
  const reduced = latestExchangeRateRows([
    rate('SAR', 'USD', '2026-08-06', 3.74, '2026-08-06T01:00:00-08:00'),
    withoutPair,
    rate('SAR', 'USD', '2026-08-06', 3.75, '2026-08-06T09:00:00-08:00'),
  ])

  assert.deepEqual(reduced, [rate('SAR', 'USD', '2026-08-06', 3.75, '2026-08-06T09:00:00-08:00'), withoutPair])
  assert.deepEqual(latestExchangeRateRows([...reduced].reverse()).length, 2)
})

test('the ExchangeRate predicate pins enabled currencies to a single as-of date', () => {
  assert.equal(
    quickBooksExchangeRateWhere(['usd', 'EUR', 'EUR', 'not-a-code'], '2026-08-06'),
    "sourcecurrencycode IN ('EUR', 'USD') AND asofdate = '2026-08-06'",
  )
  assert.equal(quickBooksExchangeRateWhere([], '2026-08-06'), undefined)
  assert.throws(() => quickBooksExchangeRateWhere(['USD'], 'today'), /Invalid QuickBooks exchange rate as-of date/)
  assert.match(currentExchangeRateAsOfDate(new Date('2026-08-06T22:15:00Z')), /^2026-08-06$/)
  assert.deepEqual(companyCurrencyCodes([{ Code: 'USD' }, { Code: 'EUR', Active: false }, { Code: 'gbp', Active: true }]), ['GBP', 'USD'])
})

test('exchange rate extraction requests only the current as-of date and finishes in one page', async () => {
  const asOfDate = currentExchangeRateAsOfDate()
  const { service, queries } = exchangeRateService(
    [{ Code: 'EUR', Active: true }, { Code: 'USD', Active: true }],
    [[rate('EUR', 'USD', asOfDate, 1.09), rate('USD', 'USD', asOfDate, 1)]],
  )
  const staged: Record<string, string>[][] = []
  const checkpoints: { fetched: number; hasMore?: boolean; startPosition: number }[] = []

  const result = await new QuickBooksImportAdapter().fetchResource(service, CONTEXT, 'exchange-rates', {
    boundedPage: true,
    resumeStartPosition: 1,
    onBatch: async (rows, checkpoint) => { staged.push(rows); checkpoints.push(checkpoint) },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint) },
  })

  const rateQueries = queries.filter((query) => query.includes('FROM ExchangeRate'))
  assert.equal(rateQueries.length, 1)
  assert.equal(
    rateQueries[0],
    `SELECT * FROM ExchangeRate WHERE sourcecurrencycode IN ('EUR', 'USD') AND asofdate = '${asOfDate}' STARTPOSITION 1 MAXRESULTS 1000`,
  )
  assert.equal(result.hasMore, false)
  assert.ok(checkpoints.every((checkpoint) => checkpoint.hasMore === false))
  assert.deepEqual(staged[0].map((row) => row._quickbooksId), [
    `ExchangeRate:EUR:USD:${asOfDate}`,
    `ExchangeRate:USD:USD:${asOfDate}`,
  ])
})

test('historical rates returned by QuickBooks are dropped before staging', async () => {
  const asOfDate = currentExchangeRateAsOfDate()
  const { service } = exchangeRateService(
    [{ Code: 'EUR', Active: true }],
    [[
      rate('EUR', 'USD', '2016-05-18', 1.11),
      rate('EUR', 'USD', '2019-09-19', 1.1),
      rate('EUR', 'USD', asOfDate, 1.09),
    ]],
  )
  const staged: Record<string, string>[][] = []

  const result = await new QuickBooksImportAdapter().fetchResource(service, CONTEXT, 'exchange-rates', {
    boundedPage: true,
    resumeStartPosition: 1,
    onBatch: async (rows) => { staged.push(rows) },
  })

  assert.equal(result.hasMore, false)
  assert.deepEqual(staged[0].map((row) => row._quickbooksId), [`ExchangeRate:EUR:USD:${asOfDate}`])
  assert.deepEqual(staged[0].map((row) => row.exchangeRate), ['1.09'])
})

test('a company without enabled currencies terminates a resumed historical cursor', async () => {
  const { service, queries } = exchangeRateService([], [])
  const checkpoints: { fetched: number; hasMore?: boolean; startPosition: number }[] = []
  const staged: Record<string, string>[][] = []

  const result = await new QuickBooksImportAdapter().fetchResource(service, CONTEXT, 'exchange-rates', {
    boundedPage: true,
    resumeStartPosition: 36501,
    onBatch: async (rows, checkpoint) => { staged.push(rows); checkpoints.push(checkpoint) },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint) },
  })

  assert.deepEqual(queries.filter((query) => query.includes('FROM ExchangeRate')), [])
  assert.equal(result.hasMore, false)
  assert.deepEqual(staged, [[]])
  assert.ok(checkpoints.length > 0)
  assert.ok(checkpoints.every((checkpoint) => checkpoint.hasMore === false && checkpoint.fetched === 0 && checkpoint.startPosition === 36501))
})

test('exchange rate preview counts enabled currencies instead of historical rows', async () => {
  const asOfDate = currentExchangeRateAsOfDate()
  const { service, queries } = exchangeRateService(
    [{ Code: 'EUR', Active: true }, { Code: 'GBP', Active: true }],
    [[rate('EUR', 'USD', '2016-05-18', 1.11), rate('EUR', 'USD', asOfDate, 1.09), rate('GBP', 'USD', asOfDate, 1.27)]],
  )

  const preview = await new QuickBooksImportAdapter().fetchResource(service, CONTEXT, 'exchange-rates', {
    preview: { sampleSize: 10, cache: new Map() },
  })

  assert.equal(preview.totalCount, 2)
  assert.equal(preview.countAccuracy, 'upper-bound')
  assert.deepEqual(preview.rows.map((row) => row._quickbooksId), [
    `ExchangeRate:EUR:USD:${asOfDate}`,
    `ExchangeRate:GBP:USD:${asOfDate}`,
  ])
  assert.ok(queries.some((query) => query.includes(`asofdate = '${asOfDate}'`)))
  assert.ok(queries.every((query) => !query.includes('COUNT(*)')))
})
