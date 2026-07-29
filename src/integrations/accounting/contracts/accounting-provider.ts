import type { CompanyInfo, ProviderTokenSet } from './types'
import type { Provider } from './types'

export interface ProviderConnectContext {
  tenantId: string
  userId: string
  state: string
}

export interface ProviderConnectResult {
  authorizationUrl: string
}

export interface ProviderOAuthCallbackContext {
  code: string
  realmId: string
}

export interface ProviderCredentialContext {
  accessToken: string | null
  refreshToken: string | null
  realmId: string | null
}

export interface ProviderAccessContext {
  accessToken: string
  realmId: string
}

export interface AccountingProvider {
  readonly slug: Provider
  connect(context: ProviderConnectContext): Promise<ProviderConnectResult>
  exchangeAuthorizationCode(context: ProviderOAuthCallbackContext): Promise<ProviderTokenSet>
  disconnect(context: ProviderCredentialContext): Promise<void>
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>
  validateConnection(context: ProviderAccessContext): Promise<boolean>
  getCompanyInfo(context: ProviderAccessContext): Promise<CompanyInfo>

  getCustomers(context: ProviderAccessContext): Promise<unknown[]>
  getInvoices(context: ProviderAccessContext): Promise<unknown[]>
  getBills(context: ProviderAccessContext): Promise<unknown[]>
  getPayments(context: ProviderAccessContext): Promise<unknown[]>
  getAccounts(context: ProviderAccessContext): Promise<unknown[]>
  getItems(context: ProviderAccessContext): Promise<unknown[]>
}
