import type {
  AccountingProvider,
  ProviderAccessContext,
  ProviderConnectContext,
  ProviderConnectResult,
  ProviderCredentialContext,
  ProviderOAuthCallbackContext,
} from '../../contracts/accounting-provider'
import { Provider, type CompanyInfo, type ProviderTokenSet } from '../../contracts/types'
import { ProviderAuthenticationException, ProviderRequestException } from '../../utils/exceptions'
import { quickBooksEndpoints, type QuickBooksConfig } from './quickbooks-config'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {}
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
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
    const companyUrl = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/companyinfo/${encodeURIComponent(context.realmId)}?minorversion=75`
    const preferencesUrl = `${this.endpoints.api}/v3/company/${encodeURIComponent(context.realmId)}/preferences?minorversion=75`
    const companyBody = await this.authorizedJson(companyUrl, context.accessToken)
    const preferencesBody = await this.authorizedJson(preferencesUrl, context.accessToken)
    const company = record(companyBody.CompanyInfo)
    const preferences = record(preferencesBody.Preferences)
    const currencyPreferences = record(preferences.CurrencyPrefs)
    const homeCurrency = record(currencyPreferences.HomeCurrency)
    return {
      realmId: context.realmId,
      companyName: textValue(company.CompanyName),
      companyEmail: textValue(record(company.Email).Address),
      country: textValue(company.Country),
      baseCurrency: textValue(homeCurrency.value) ?? textValue(homeCurrency.Value),
      timezone: textValue(company.DefaultTimeZone),
      legalName: textValue(company.LegalName),
    }
  }

  async getCustomers(): Promise<unknown[]> { return [] }
  async getInvoices(): Promise<unknown[]> { return [] }
  async getBills(): Promise<unknown[]> { return [] }
  async getPayments(): Promise<unknown[]> { return [] }
  async getAccounts(): Promise<unknown[]> { return [] }
  async getItems(): Promise<unknown[]> { return [] }

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
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401) throw new ProviderAuthenticationException()
    if (!response.ok) throw new ProviderRequestException('QuickBooks company information request failed.')
    return record(await response.json())
  }

  private basicAuthorization(): string {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64')}`
  }
}
