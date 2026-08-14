import type {
  ConnectionStatus,
  IntegrationConnectionRecord,
  IntegrationLogRecord,
  IntegrationOAuthStateRecord,
  IntegrationProviderRecord,
  Provider,
} from './types'

export interface CreateConnectionInput {
  tenantId: string
  providerId: string
  status: ConnectionStatus
  connectedBy: string
  accessToken?: string | null
  refreshToken?: string | null
  refreshExpiresAt?: Date | null
}

export interface UpdateConnectionInput {
  status?: ConnectionStatus
  environment?: 'sandbox' | 'production' | null
  realmId?: string | null
  companyName?: string | null
  companyEmail?: string | null
  country?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  expiresAt?: Date | null
  refreshExpiresAt?: Date | null
  lastSync?: Date | null
  lastError?: string | null
  baseCurrency?: string | null
  timezone?: string | null
  legalName?: string | null
  connectedAt?: Date | null
}

export interface CreateOAuthStateInput {
  stateHash: string
  tenantId: string
  providerId: string
  connectionId: string
  createdBy: string
  expiresAt: Date
}

export interface IntegrationRepository {
  listProviders(): Promise<IntegrationProviderRecord[]>
  findProviderBySlug(slug: Provider): Promise<IntegrationProviderRecord | null>
  findCurrentConnection(tenantId: string, providerId: string): Promise<IntegrationConnectionRecord | null>
  findConnectionById(connectionId: string, tenantId: string): Promise<IntegrationConnectionRecord | null>
  createConnection(input: CreateConnectionInput): Promise<IntegrationConnectionRecord>
  updateConnection(connectionId: string, tenantId: string, input: UpdateConnectionInput): Promise<IntegrationConnectionRecord>
  createLog(input: Omit<IntegrationLogRecord, 'id' | 'createdAt'>): Promise<IntegrationLogRecord>
  createOAuthState(input: CreateOAuthStateInput): Promise<IntegrationOAuthStateRecord>
  findOAuthState(stateHash: string): Promise<IntegrationOAuthStateRecord | null>
  consumeOAuthState(stateId: string, consumedAt: Date): Promise<IntegrationOAuthStateRecord | null>
  deleteOAuthState(stateId: string): Promise<void>
}
