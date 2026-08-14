export enum Provider {
  QUICKBOOKS = 'quickbooks',
  XERO = 'xero',
  ZOHO = 'zoho',
  SAGE = 'sage',
  ODOO = 'odoo',
}

export enum ConnectionStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
  DISCONNECTED = 'DISCONNECTED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
}

export interface IntegrationProviderRecord {
  id: string
  name: string
  slug: Provider
  logo: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** QuickBooks OAuth/API environment that issued this connection. Null = legacy (treat as sandbox). */
export type IntegrationConnectionEnvironment = 'sandbox' | 'production'

export interface IntegrationConnectionRecord {
  id: string
  tenantId: string
  providerId: string
  status: ConnectionStatus
  /** sandbox | production | null (legacy → sandbox) */
  environment: IntegrationConnectionEnvironment | null
  realmId: string | null
  companyName: string | null
  companyEmail: string | null
  country: string | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  refreshExpiresAt: Date | null
  lastSync: Date | null
  lastError: string | null
  baseCurrency: string | null
  timezone: string | null
  legalName: string | null
  connectedAt: Date | null
  connectedBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface IntegrationLogRecord {
  id: string
  connectionId: string
  action: string
  status: string
  message: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface CompanyInfo {
  realmId: string | null
  companyName: string | null
  companyEmail: string | null
  country: string | null
  baseCurrency: string | null
  timezone: string | null
  legalName: string | null
  /** Provider-reported fiscal-year start, when available. */
  fiscalYear?: string | null
}

export interface ProviderTokenSet {
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

export interface IntegrationOAuthStateRecord {
  id: string
  stateHash: string
  tenantId: string
  providerId: string
  connectionId: string
  createdBy: string
  createdAt: Date
  expiresAt: Date
  consumedAt: Date | null
}

export interface ConnectionStatusDto {
  connected: boolean
  companyName: string | null
  lastSync: string | null
  realmId: string | null
  companyEmail: string | null
  country: string | null
  baseCurrency: string | null
  timezone: string | null
  legalName: string | null
  connectedAt: string | null
  status: ConnectionStatus
  /** Environment that issued the stored connection (legacy null → sandbox). */
  environment: IntegrationConnectionEnvironment | null
  /** Process QB_ENVIRONMENT / NODE_ENV resolution for this server. */
  serverEnvironment: IntegrationConnectionEnvironment
  /** True when stored connection env does not match the server environment. */
  environmentMismatch: boolean
  /** True when a production migration may use this connection. */
  productionReady: boolean
}
