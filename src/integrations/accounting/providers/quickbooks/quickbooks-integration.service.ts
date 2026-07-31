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

type JsonRecord = Record<string, unknown>
const QUERY_PAGE_SIZE = 1000
const MINOR_VERSION = '75'
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

export class QuickBooksIntegrationService implements AccountingProvider {
  readonly slug = Provider.QUICKBOOKS
  private readonly endpoints

  constructor(
    private readonly config: QuickBooksConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
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

  async getEntityCount(context:ProviderAccessContext,entity:string):Promise<number>{
    if(!/^[A-Za-z][A-Za-z0-9]*$/.test(entity))throw new ProviderRequestException('Invalid QuickBooks entity name.')
    const url=new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/query`)
    url.searchParams.set('query',`SELECT COUNT(*) FROM ${entity}`)
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
    if (options.partitioned && TRANSACTION_DATE_ENTITIES.has(entity)) return this.queryPartitioned(context, entity, options)
    return this.queryPages(context, entity, options)
  }

  private async queryPartitioned(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions): Promise<unknown[]> {
    const first = options.partitionStart ?? new Date('1900-01-01T00:00:00.000Z')
    const last = options.partitionEnd ?? new Date(Date.UTC(this.now().getUTCFullYear() + 1, 0, 1))
    const rows: unknown[] = []
    let resumePosition = options.startPosition ?? 1
    for (let start = new Date(first); start < last;) {
      const end = new Date(Math.min(Date.UTC(start.getUTCFullYear() + 10, start.getUTCMonth(), start.getUTCDate()), last.getTime()))
      const where = `TxnDate >= '${start.toISOString().slice(0, 10)}' AND TxnDate < '${end.toISOString().slice(0, 10)}'`
      rows.push(...await this.queryPages(context, entity, { ...options, partitioned: false, startPosition: resumePosition }, where, rows.length, start, end))
      resumePosition = 1
      start = end
    }
    return rows
  }

  private async queryPages(context: ProviderAccessContext, entity: string, options: ProviderEntityFetchOptions, where?: string, offset = 0, partitionStart?: Date, partitionEnd?: Date): Promise<unknown[]> {
    const pageSize = Math.min(QUERY_PAGE_SIZE, Math.max(1, options.pageSize ?? QUERY_PAGE_SIZE))
    const rows: unknown[] = []
    const inactive = options.includeInactive && INACTIVE_ENTITIES.has(entity) ? 'Active IN (true, false)' : ''
    const predicate = [where, inactive].filter(Boolean).join(' AND ')
    for (let start = options.startPosition ?? 1; ; start += pageSize) {
      const query = `SELECT * FROM ${entity}${predicate ? ` WHERE ${predicate}` : ''} STARTPOSITION ${start} MAXRESULTS ${pageSize}`
      const url = new URL(`${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/query`)
      url.searchParams.set('query', query)
      url.searchParams.set('minorversion', MINOR_VERSION)
      const body = await this.authorizedJson(url.toString(), context.accessToken)
      const response = record(body.QueryResponse)
      const page = Array.isArray(response[entity])
        ? response[entity] as unknown[]
        : response[entity] ? [response[entity]] : []
      rows.push(...page)
      const checkpoint={ startPosition: start + page.length, partitionStart: partitionStart?.toISOString(), partitionEnd: partitionEnd?.toISOString(), extractedCount: offset + rows.length }
      if(options.onPage)await options.onPage(page,checkpoint)
      if (options.onCheckpoint) await options.onCheckpoint(checkpoint)
      if (page.length < pageSize) break
    }
    return rows
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

  private async authorizedJson(url: string, accessToken: string): Promise<JsonRecord> {
    return record(await (await this.authorizedResponse(url, accessToken)).json())
  }

  private async authorizedResponse(url: string, accessToken: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await this.fetchImpl(url, {
        headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
        signal: AbortSignal.timeout(60_000),
      })
      if (response.status === 401) throw new ProviderAuthenticationException()
      if (response.ok) return response
      if (response.status !== 429 && response.status < 500) throw new ProviderRequestException(`QuickBooks data request failed (${response.status}).`)
      lastError = new ProviderRequestException(`QuickBooks data request failed (${response.status}).`)
      const retryAfter = Number(response.headers.get('retry-after'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : Math.min(1000 * 2 ** attempt, 15_000)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    throw lastError ?? new ProviderRequestException('QuickBooks data request failed.')
  }

  private basicAuthorization(): string {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64')}`
  }
}
