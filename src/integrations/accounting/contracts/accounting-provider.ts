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

export interface ProviderEntityFetchOptions {
  includeInactive?: boolean
  partitioned?: boolean
  partitionStart?: Date
  partitionEnd?: Date
  pageSize?: number
  /** Stop after this many records. Used by previews to prevent full pagination. */
  maxRecords?: number
  /** Provider-owned predicate used for bounded entity variants such as projects. */
  where?: string
  startPosition?: number
  /** Do not retain page payloads when the caller durably stages each page. */
  retainRows?: boolean
  /** Cancels pagination, checkpoint callbacks, retry backoff, and requests. */
  signal?: AbortSignal
  onCheckpoint?: (checkpoint: { startPosition: number; partitionStart?: string; partitionEnd?: string; extractedCount: number }) => Promise<void>
  onPage?: (rows:unknown[],checkpoint:{startPosition:number;partitionStart?:string;partitionEnd?:string;extractedCount:number})=>Promise<void>
}

export interface ProviderCdcResult {
  changedSince: string
  fetchedAt: string
  entities: Record<string, unknown[]>
}

export interface ProviderReportRequest {
  reportName: string
  parameters?: Record<string, string | number | boolean>
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
  getVendors(context: ProviderAccessContext): Promise<unknown[]>
  getInvoices(context: ProviderAccessContext): Promise<unknown[]>
  getBills(context: ProviderAccessContext): Promise<unknown[]>
  getPayments(context: ProviderAccessContext): Promise<unknown[]>
  getCustomerPayments?(context: ProviderAccessContext): Promise<unknown[]>
  getVendorPayments?(context: ProviderAccessContext): Promise<unknown[]>
  getExpenses?(context: ProviderAccessContext): Promise<unknown[]>
  getJournalEntries?(context: ProviderAccessContext): Promise<unknown[]>
  getSalesReceipts?(context: ProviderAccessContext): Promise<unknown[]>
  getPurchaseOrders?(context: ProviderAccessContext): Promise<unknown[]>
  getVendorCredits?(context: ProviderAccessContext): Promise<unknown[]>
  getEstimates?(context: ProviderAccessContext): Promise<unknown[]>
  getAccounts(context: ProviderAccessContext): Promise<unknown[]>
  getItems(context: ProviderAccessContext): Promise<unknown[]>
  getTaxCodes(context: ProviderAccessContext): Promise<unknown[]>
  getTaxRates?(context: ProviderAccessContext): Promise<unknown[]>
  getPaymentTerms(context: ProviderAccessContext): Promise<unknown[]>
  getEntityRecords?(context: ProviderAccessContext, entity: string, options?: ProviderEntityFetchOptions): Promise<unknown[]>
  getEntityCount?(context: ProviderAccessContext, entity: string, options?: Pick<ProviderEntityFetchOptions, 'where'>): Promise<number>
  getPreferences?(context: ProviderAccessContext): Promise<unknown[]>
  getReports?(context: ProviderAccessContext, requests: ProviderReportRequest[]): Promise<Record<string, unknown>>
  getChangeData?(context: ProviderAccessContext, entities: string[], changedSince: Date): Promise<ProviderCdcResult>
  downloadAttachment?(context: ProviderAccessContext, attachableId: string): Promise<{ url: string; content?: ArrayBuffer; contentType?: string }>
}
