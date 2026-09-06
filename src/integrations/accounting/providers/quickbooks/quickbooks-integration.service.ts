import type {
  AccountingProvider,
  ProviderAccessContext,
  ProviderConnectContext,
  ProviderConnectResult,
  ProviderCredentialContext,
  ProviderCdcResult,
  ProviderEntityFetchOptions,
  ProviderOAuthCallbackContext,
  ProviderReportRequest,
} from '../../contracts/accounting-provider'
import { Provider, type CompanyInfo, type ProviderTokenSet } from '../../contracts/types'
import { ProviderAuthenticationException, ProviderRequestException } from '../../utils/exceptions'
import { quickBooksEndpoints, type QuickBooksConfig } from './quickbooks-config'
import { diagnosticFetch } from '@/lib/ops/external-request-diagnostics'
import { createHash } from 'node:crypto'

type JsonRecord = Record<string, unknown>
const QUERY_PAGE_SIZE = 1000
const MINOR_VERSION = '75'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_REQUEST_ATTEMPTS = 5
const INACTIVE_ENTITIES = new Set(['Account', 'Class', 'Customer', 'Department', 'Employee', 'Item', 'PaymentMethod', 'TaxCode', 'Term', 'Vendor'])
const TRANSACTION_DATE_ENTITIES = new Set(['Bill', 'BillPayment', 'CreditMemo', 'Deposit', 'Estimate', 'InventoryAdjustment', 'Invoice', 'JournalEntry', 'Payment', 'Purchase', 'PurchaseOrder', 'RefundReceipt', 'SalesReceipt', 'Transfer', 'VendorCredit'])

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {}
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function fiscalYearValue(value: unknown): string | null {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  if (!raw) return null
  const month = Number(raw)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return Number.isInteger(month) && month >= 1 && month <= 12 ? months[month - 1] : raw
}

interface QueryPageResult {
  rows: unknown[]
  count: number
  hasMore: boolean
  partitionComplete?: boolean
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function networkFailure(error: unknown): string {
  const current = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const cause = current.cause !== null && typeof current.cause === 'object' ? current.cause as Record<string, unknown> : {}
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof current.code === 'string' ? current.code : typeof cause.code === 'string' ? cause.code : null
  return `${name}: ${message}${code ? ` (${code})` : ''}`
}

function quickBooksResponseDetails(body: string): { intuitErrors: unknown[]; detail: string } {
  try {
    const parsed = JSON.parse(body) as JsonRecord
    const fault = record(parsed.Fault)
    const errors = Array.isArray(fault.Error) ? fault.Error : Array.isArray(parsed.Error) ? parsed.Error : []
    const intuitErrors = errors.length ? errors : [parsed]
    return { intuitErrors, detail: JSON.stringify(parsed) }
  } catch {
    return { intuitErrors: [], detail: body.slice(0, 4_000) }
  }
}

/** Returns the HTTP status from a QuickBooks request failure, including retried failures. */
export function quickBooksErrorStatus(error: unknown): number | null {
  const current = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const cause = current.cause
  if (typeof current.quickBooksStatus === 'number') return current.quickBooksStatus
  if (cause && cause !== current) return quickBooksErrorStatus(cause)
  return null
}

export class QuickBooksIntegrationService implements AccountingProvider {
  readonly slug = Provider.QUICKBOOKS
  readonly environment
  private readonly endpoints

  constructor(
    private readonly config: QuickBooksConfig,
    private readonly fetchImpl: typeof fetch = diagnosticFetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.environment = config.environment
    this.endpoints = quickBooksEndpoints(config.environment)
  }

  async connect(context: ProviderConnectContext): Promise<ProviderConnectResult> {
    const url = new URL(this.endpoints.authorization)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', ['com.intuit.quickbooks.accounting', ...(this.config.additionalScopes ?? [])].join(' '))
    url.searchParams.set('state', context.state)
    return { authorizationUrl: url.toString() }
  }

  async exchangeAuthorizationCode(context: ProviderOAuthCallbackContext): Promise<ProviderTokenSet> {
    return this.requestTokens(new URLSearchParams({
      grant_type: 'authorization_code',
      code: context.code,
      redirect_uri: this.config.redirectUri,
    }))
  }

  async disconnect(context: ProviderCredentialContext): Promise<void> {
    const token = context.refreshToken ?? context.accessToken
    if (!token) return
    const response = await this.fetchImpl(this.endpoints.revoke, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: this.basicAuthorization(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new ProviderRequestException('QuickBooks token revocation failed.')
  }

  async refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.requestTokens(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }))
  }

  async validateConnection(context: ProviderAccessContext): Promise<boolean> {
    try {
      await this.getCompanyInfo(context)
      return true
    } catch (error) {
      if (error instanceof ProviderAuthenticationException) return false
      throw error
    }
  }

  async getCompanyInfo(context: ProviderAccessContext): Promise<CompanyInfo> {
    const companyUrl = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/companyinfo/${encodeURIComponent(context.realmId)}?minorversion=${MINOR_VERSION}`
    const preferencesUrl = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/preferences?minorversion=${MINOR_VERSION}`
    const companyBody = await this.authorizedJson(companyUrl, context.accessToken)
    const preferencesBody = await this.authorizedJson(preferencesUrl, context.accessToken)
    const company = record(companyBody.CompanyInfo)
    const preferences = record(preferencesBody.Preferences)
    const currencyPreferences = record(preferences.CurrencyPrefs)
    const homeCurrency = record(currencyPreferences.HomeCurrency)
    const fiscalYear = preferences.FiscalYearStartMonth
      ?? preferences.StartOfFiscalYear
      ?? preferences.FiscalYearStart
    return {
      realmId: context.realmId,
      companyName: textValue(company.CompanyName),
      companyEmail: textValue(record(company.Email).Address),
      country: textValue(company.Country),
      baseCurrency: textValue(homeCurrency.value) ?? textValue(homeCurrency.Value),
      timezone: textValue(company.DefaultTimeZone),
      legalName: textValue(company.LegalName),
      fiscalYear: fiscalYearValue(record(fiscalYear).value)
        ?? fiscalYearValue(record(fiscalYear).Value)
        ?? fiscalYearValue(fiscalYear),
    }
  }

  async getCustomers(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Customer', { includeInactive: true }) }
  async getVendors(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Vendor', { includeInactive: true }) }
  async getInvoices(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Invoice') }
  async getBills(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Bill') }
  async getPayments(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Payment') }
  async getCustomerPayments(context: ProviderAccessContext): Promise<unknown[]> {
    return (await this.getPayments(context)).filter((row) => Boolean(record(row).CustomerRef))
  }
  async getVendorPayments(context: ProviderAccessContext): Promise<unknown[]> {
    return this.queryAll(context, 'BillPayment')
  }
  async getExpenses(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Purchase') }
  async getJournalEntries(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'JournalEntry') }
  async getSalesReceipts(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'SalesReceipt') }
  async getPurchaseOrders(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'PurchaseOrder') }
  async getVendorCredits(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'VendorCredit') }
  async getEstimates(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Estimate') }
  async getAccounts(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Account', { includeInactive: true }) }
  async getItems(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Item', { includeInactive: true }) }
  async getTaxCodes(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'TaxCode', { includeInactive: true }) }
  async getTaxRates(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'TaxRate') }
  async getPaymentTerms(context: ProviderAccessContext): Promise<unknown[]> { return this.queryAll(context, 'Term', { includeInactive: true }) }

  async getEntityRecords(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions = {}): Promise<unknown[]> {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(entity)) throw new ProviderRequestException('Invalid QuickBooks entity name.')
    return this.queryAll(context, entity, options)
  }

  async getEntityCount(context:ProviderAccessContext,entity:string,options:Pick<ProviderEntityFetchOptions,'where'>={}):Promise<number>{
    if(!/^[A-Za-z][A-Za-z0-9]*$/.test(entity))throw new ProviderRequestException('Invalid QuickBooks entity name.')
    const url=new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/query`)
    url.searchParams.set('query',`SELECT COUNT(*) FROM ${entity}${options.where ? ` WHERE ${options.where}` : ''}`)
    url.searchParams.set('minorversion',MINOR_VERSION)
    const body=await this.authorizedJson(url.toString(),context.accessToken),response=record(body.QueryResponse)
    return Number(response.totalCount??0)
  }

  async getPreferences(context: ProviderAccessContext): Promise<unknown[]> {
    const url = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/preferences?minorversion=${MINOR_VERSION}`
    const body = await this.authorizedJson(url, context.accessToken)
    return body.Preferences ? [body.Preferences] : []
  }

  async getReports(context: ProviderAccessContext, requests: ProviderReportRequest[]): Promise<Record<string, unknown>> {
    const reports: Record<string, unknown> = {}
    for (const request of requests) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(request.reportName)) throw new ProviderRequestException('Invalid QuickBooks report name.')
      const url = new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/reports/${request.reportName}`)
      url.searchParams.set('minorversion', MINOR_VERSION)
      for (const [key, value] of Object.entries(request.parameters ?? {})) url.searchParams.set(key, String(value))
      reports[request.reportName] = await this.authorizedJson(url.toString(), context.accessToken)
    }
    return reports
  }

  async getChangeData(context: ProviderAccessContext, entities: string[], changedSince: Date): Promise<ProviderCdcResult> {
    const unique = [...new Set(entities.filter(entity => /^[A-Za-z][A-Za-z0-9]*$/.test(entity)))]
    if (!unique.length) throw new ProviderRequestException('At least one CDC entity is required.')
    const earliest = new Date(this.now().getTime() - 30 * 86400000)
    const since = changedSince < earliest ? earliest : changedSince
    const aggregated: Record<string, unknown[]> = {}
    for (let index = 0; index < unique.length; index += 30) {
      const url = new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/cdc`)
      url.searchParams.set('entities', unique.slice(index, index + 30).join(','))
      url.searchParams.set('changedSince', since.toISOString())
      url.searchParams.set('minorversion', MINOR_VERSION)
      const body = await this.authorizedJson(url.toString(), context.accessToken)
      const responses = Array.isArray(body.CDCResponse) ? body.CDCResponse : []
      for (const response of responses) {
        const query = record(record(response).QueryResponse)
        for (const [entity, value] of Object.entries(query)) {
          if (['startPosition', 'maxResults', 'totalCount'].includes(entity)) continue
          const rows = Array.isArray(value) ? value : value ? [value] : []
          aggregated[entity] = [...(aggregated[entity] ?? []), ...rows]
        }
      }
    }
    return { changedSince: since.toISOString(), fetchedAt: this.now().toISOString(), entities: aggregated }
  }

  async downloadAttachment(context: ProviderAccessContext, attachableId: string): Promise<{ url: string; content?: ArrayBuffer; contentType?: string }> {
    const endpoint = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/download/${encodeURIComponent(attachableId)}`
    const response = await this.authorizedResponse(endpoint, context.accessToken, { Accept: 'text/plain' })
    const contentType = response.headers.get('content-type') ?? undefined
    if (contentType?.includes('json')) {
      const body = record(await response.json())
      const url = textValue(body.TempDownloadUri) ?? textValue(body.TempDownloadUrl)
      if (!url) throw new ProviderRequestException('QuickBooks did not return an attachment download URL.')
      return { url, contentType }
    }
    const text = (await response.text()).trim()
    if (!text) throw new ProviderRequestException('QuickBooks returned an empty attachment download response.')
    return { url: text, contentType }
  }

  private async queryAll(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions = {}): Promise<unknown[]> {
    if (options.partitioned && TRANSACTION_DATE_ENTITIES.has(entity)) return (await this.queryPartitioned(context, entity, options)).rows
    return (await this.queryPages(context, entity, options, options.where)).rows
  }

  private async queryPartitioned(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions): Promise<QueryPageResult> {
    const first = options.partitionStart ?? await this.findEarliestTransactionDate(context, entity, options.signal)
    if (!first) return { rows: [], count: 0, hasMore: false }
    const last = options.partitionEnd ?? new Date(Date.UTC(this.now().getUTCFullYear() + 1, 0, 1))
    const rows: unknown[] = []
    let extractedCount = 0
    let resumePosition = options.startPosition ?? 1
    for (let start = new Date(first); start < last;) {
      if (options.signal?.aborted) throw options.signal.reason
      const end = new Date(Math.min(Date.UTC(start.getUTCFullYear() + 10, start.getUTCMonth(), start.getUTCDate()), last.getTime()))
      const where = `TxnDate >= '${start.toISOString().slice(0, 10)}' AND TxnDate < '${end.toISOString().slice(0, 10)}'`
      const remaining = options.maxRecords === undefined ? undefined : Math.max(0, options.maxRecords - extractedCount)
      if (remaining === 0) break
      const pageResult = await this.queryPages(context, entity, { ...options, partitioned: false, startPosition: resumePosition, maxRecords: remaining }, where, extractedCount, start, end)
      if (options.retainRows !== false) rows.push(...pageResult.rows)
      extractedCount += pageResult.count
      if (options.maxPages && pageResult.partitionComplete) {
        const hasMore = end < last
        const nextCheckpoint = { startPosition: 1, partitionStart: end.toISOString(), partitionEnd: undefined, extractedCount, hasMore, partitionComplete: false }
        if (options.onCheckpoint) await options.onCheckpoint(nextCheckpoint)
        return { rows, count: extractedCount, hasMore, partitionComplete: false }
      }
      if (options.maxPages && pageResult.hasMore) {
        return { rows, count: extractedCount, hasMore: true, partitionComplete: false }
      }
      resumePosition = 1
      start = end
    }
    return { rows, count: extractedCount, hasMore: false }
  }

  private async findEarliestTransactionDate(context: ProviderAccessContext, entity: string, signal?: AbortSignal): Promise<Date | null> {
    const query = `SELECT * FROM ${entity} ORDERBY TxnDate ASC STARTPOSITION 1 MAXRESULTS 1`
    const url = new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/query`)
    url.searchParams.set('query', query)
    url.searchParams.set('minorversion', MINOR_VERSION)
    const body = await this.authorizedJson(url.toString(), context.accessToken, signal)
    const response = record(body.QueryResponse)
    const first = Array.isArray(response[entity]) ? response[entity][0] : response[entity]
    const date = textValue(record(first).TxnDate)
    if (!date) return null
    const parsed = new Date(`${date}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private async queryPages(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions, where?: string, offset = 0, partitionStart?: Date, partitionEnd?: Date): Promise<QueryPageResult> {
    const configuredPageSize = Math.min(QUERY_PAGE_SIZE, Math.max(1, options.pageSize ?? QUERY_PAGE_SIZE))
    const maxRecords = options.maxRecords === undefined ? Number.POSITIVE_INFINITY : Math.max(0, options.maxRecords)
    const rows: unknown[] = []
    let fetchedCount = 0
    let pages = 0
    // Tracks whether the last page filled `pageSize`. A short final page means
    // the partition window is exhausted; a full final page (e.g. we stopped on
    // `maxPages`) means the window still has more records to resume.
    let lastPageWasFull = false
    const inactive = options.includeInactive && INACTIVE_ENTITIES.has(entity) ? 'Active IN (true, false)' : ''
    const predicate = [where, inactive].filter(Boolean).join(' AND ')
    let previousPageSignature:string|null=null
    for (let start = options.startPosition ?? 1; fetchedCount < maxRecords;) {
      if (options.signal?.aborted) throw options.signal.reason
      const pageSize = Math.min(configuredPageSize, maxRecords - fetchedCount)
      const query = `SELECT * FROM ${entity}${predicate ? ` WHERE ${predicate}` : ''} STARTPOSITION ${start} MAXRESULTS ${pageSize}`
      const url = new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/query`)
      url.searchParams.set('query', query)
      url.searchParams.set('minorversion', MINOR_VERSION)
      const body = await this.authorizedJson(url.toString(), context.accessToken, options.signal)
      const response = record(body.QueryResponse)
      const page = Array.isArray(response[entity])
        ? response[entity] as unknown[]
        : response[entity] ? [response[entity]] : []
      const returnedStart=Number(response.startPosition)
      if(Number.isFinite(returnedStart)&&returnedStart>0&&returnedStart!==start)throw new ProviderRequestException(`QuickBooks pagination did not advance for ${entity}: requested ${start}, received ${returnedStart}.`)
      const pageSignature=createHash('sha256').update(JSON.stringify([page.length,page[0]??null,page.at(-1)??null])).digest('hex')
      if(page.length&&pageSignature===previousPageSignature)throw new ProviderRequestException(`QuickBooks pagination repeated a page for ${entity} at STARTPOSITION ${start}.`)
      previousPageSignature=pageSignature
      if (options.retainRows !== false) rows.push(...page)
      fetchedCount += page.length
      pages += 1
      lastPageWasFull = page.length >= pageSize
      const pageHasMore = page.length >= pageSize && fetchedCount < maxRecords
      const partitionComplete = Boolean(partitionStart && page.length < pageSize)
      const checkpoint={ startPosition: start + page.length, partitionStart: partitionStart?.toISOString(), partitionEnd: partitionEnd?.toISOString(), extractedCount: offset + fetchedCount, hasMore: pageHasMore, partitionComplete }
      if(options.onPage)await options.onPage(page,checkpoint)
      if (options.onCheckpoint) await options.onCheckpoint(checkpoint)
      if (page.length < pageSize || fetchedCount >= maxRecords || (options.maxPages && pages >= options.maxPages)) break
      start += page.length
    }
    // A partition window is complete only when its final page was short. When we
    // stopped on `maxPages` mid-window the last page was full, so the window is
    // NOT complete and the caller must resume it from the advanced STARTPOSITION
    // rather than skipping to the next window.
    return { rows, count: fetchedCount, hasMore: Boolean(options.maxPages && pages >= options.maxPages && fetchedCount > 0), partitionComplete: Boolean(partitionStart) && !lastPageWasFull }
  }

  private async requestTokens(body: URLSearchParams): Promise<ProviderTokenSet> {
    const response = await this.fetchImpl(this.endpoints.token, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: this.basicAuthorization(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-include-refresh-token-hard-expires-in': 'true',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new ProviderAuthenticationException('QuickBooks rejected the OAuth grant.')
      }
      throw new ProviderRequestException('QuickBooks token request failed.')
    }
    const payload = record(await response.json())
    const accessToken = textValue(payload.access_token)
    const refreshToken = textValue(payload.refresh_token)
    const accessLifetime = Number(payload.expires_in)
    const refreshLifetime = Number(payload.x_refresh_token_expires_in)
    if (!accessToken || !refreshToken || !Number.isFinite(accessLifetime) || !Number.isFinite(refreshLifetime)) {
      throw new ProviderRequestException('QuickBooks returned an invalid token response.')
    }
    const issuedAt = this.now().getTime()
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(issuedAt + accessLifetime * 1000),
      refreshExpiresAt: new Date(issuedAt + refreshLifetime * 1000),
    }
  }

  private async authorizedJson(url: string, accessToken: string, signal?: AbortSignal): Promise<JsonRecord> {
    return record(await (await this.authorizedResponse(url, accessToken, {}, signal)).json())
  }

  private async authorizedResponse(url: string, accessToken: string, extraHeaders: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw signal.reason
      try {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...extraHeaders,
          },
          signal: requestSignal,
        })
        if (response.status === 401) throw new ProviderAuthenticationException()
        if (response.ok) return response
        const responseBody = await response.text()
        const responseDetails = quickBooksResponseDetails(responseBody)
        // Fixed Assets validation uses the Item Query endpoint. Keep the complete
        // URL/query and Intuit response visible so unsupported Sandbox editions
        // can be distinguished from authentication or transport failures.
        console.error('[quickbooks] request failed', JSON.stringify({
          url,
          status: response.status,
          responseBody: responseDetails.detail,
          intuitErrors: responseDetails.intuitErrors,
        }))
        const failure = new ProviderRequestException(
          `QuickBooks data request failed (${response.status}). ${responseDetails.detail}`,
          response.status,
          { cause: { quickBooksStatus: response.status, url, responseBody: responseDetails.detail, intuitErrors: responseDetails.intuitErrors } },
        )
        if (response.status !== 429 && response.status < 500) throw failure
        lastError = failure
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : Math.min(1000 * 2 ** attempt, 15_000)
        await abortableDelay(delay, signal)
      } catch (error) {
        if (error instanceof ProviderAuthenticationException) throw error
        if (error instanceof ProviderRequestException && error.message.includes('failed (') && !/\((429|5\d\d)\)/.test(error.message)) throw error
        if (signal?.aborted) throw signal.reason
        lastError = error
        if (attempt < MAX_REQUEST_ATTEMPTS - 1) await abortableDelay(Math.min(1000 * 2 ** attempt, 15_000), signal)
      }
    }
    const detail = lastError ? networkFailure(lastError) : 'unknown transport failure'
    throw new ProviderRequestException(`QuickBooks data request failed after ${MAX_REQUEST_ATTEMPTS} attempts: ${detail}`, 502, { cause:lastError })
  }

  private basicAuthorization(): string {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64')}`
  }
}
