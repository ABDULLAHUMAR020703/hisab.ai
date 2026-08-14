import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CreateConnectionInput,
  CreateOAuthStateInput,
  IntegrationRepository,
  UpdateConnectionInput,
} from '../contracts/repositories'
import {
  ConnectionStatus,
  type IntegrationConnectionRecord,
  type IntegrationLogRecord,
  type IntegrationOAuthStateRecord,
  type IntegrationProviderRecord,
  type Provider,
} from '../contracts/types'
import { ConnectionAlreadyExistsException } from '../utils/exceptions'
import { ACCOUNTING_INTEGRATION_TABLES } from './accounting-integration-tables'

type Row = Record<string, unknown>

interface SupabasePersistenceError {
  message: string
  details?: string | null
  hint?: string | null
  code?: string
}

class AccountingIntegrationPersistenceError extends Error {
  readonly details?: string | null
  readonly hint?: string | null
  readonly code?: string
  readonly postgrestErrorBody: SupabasePersistenceError

  constructor(error: SupabasePersistenceError) {
    super(error.message)
    this.name = 'AccountingIntegrationPersistenceError'
    this.details = error.details
    this.hint = error.hint
    this.code = error.code
    this.postgrestErrorBody = {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    }
  }
}

function throwPersistenceError(error: SupabasePersistenceError): never {
  throw new AccountingIntegrationPersistenceError(error)
}

function providerFromRow(row: Row): IntegrationProviderRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: row.slug as Provider,
    logo: (row.logo as string | null) ?? null,
    isActive: Boolean(row.is_active),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  }
}

function connectionFromRow(row: Row): IntegrationConnectionRecord {
  const environmentRaw = row.environment
  const environment =
    environmentRaw === 'sandbox' || environmentRaw === 'production' ? environmentRaw : null
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    providerId: String(row.provider_id),
    status: row.status as ConnectionStatus,
    environment,
    realmId: (row.realm_id as string | null) ?? null,
    companyName: (row.company_name as string | null) ?? null,
    companyEmail: (row.company_email as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    accessToken: (row.access_token as string | null) ?? null,
    refreshToken: (row.refresh_token as string | null) ?? null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    refreshExpiresAt: row.refresh_expires_at ? new Date(String(row.refresh_expires_at)) : null,
    lastSync: row.last_sync ? new Date(String(row.last_sync)) : null,
    lastError: (row.last_error as string | null) ?? null,
    baseCurrency: (row.base_currency as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    legalName: (row.legal_name as string | null) ?? null,
    connectedAt: row.connected_at ? new Date(String(row.connected_at)) : null,
    connectedBy: (row.connected_by as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  }
}

function oauthStateFromRow(row: Row): IntegrationOAuthStateRecord {
  return {
    id: String(row.id),
    stateHash: String(row.state_hash),
    tenantId: String(row.company_id),
    providerId: String(row.provider_id),
    connectionId: String(row.connection_id),
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)),
    expiresAt: new Date(String(row.expires_at)),
    consumedAt: row.consumed_at ? new Date(String(row.consumed_at)) : null,
  }
}

export class SupabaseIntegrationRepository implements IntegrationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listProviders(): Promise<IntegrationProviderRecord[]> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.providers).select('*').order('name')
    if (error) throwPersistenceError(error)
    return (data ?? []).map((row) => providerFromRow(row as Row))
  }

  async findProviderBySlug(slug: Provider): Promise<IntegrationProviderRecord | null> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.providers).select('*').eq('slug', slug).maybeSingle()
    if (error) throwPersistenceError(error)
    return data ? providerFromRow(data as Row) : null
  }

  async findCurrentConnection(tenantId: string, providerId: string): Promise<IntegrationConnectionRecord | null> {
    const { data, error } = await this.client
      .from(ACCOUNTING_INTEGRATION_TABLES.connections)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('provider_id', providerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throwPersistenceError(error)
    return data ? connectionFromRow(data as Row) : null
  }

  async findConnectionById(connectionId: string, tenantId: string): Promise<IntegrationConnectionRecord | null> {
    const { data, error } = await this.client
      .from(ACCOUNTING_INTEGRATION_TABLES.connections)
      .select('*')
      .eq('id', connectionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) throwPersistenceError(error)
    return data ? connectionFromRow(data as Row) : null
  }

  async createConnection(input: CreateConnectionInput): Promise<IntegrationConnectionRecord> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.connections).insert({
      tenant_id: input.tenantId,
      provider_id: input.providerId,
      status: input.status,
      connected_by: input.connectedBy,
      access_token: input.accessToken ?? null,
      refresh_token: input.refreshToken ?? null,
      refresh_expires_at: input.refreshExpiresAt?.toISOString() ?? null,
    }).select('*').single()
    if (error?.code === '23505') throw new ConnectionAlreadyExistsException()
    if (error) throwPersistenceError(error)
    return connectionFromRow(data as Row)
  }

  async updateConnection(connectionId: string, tenantId: string, input: UpdateConnectionInput): Promise<IntegrationConnectionRecord> {
    const patch: Row = {}
    if (input.status !== undefined) patch.status = input.status
    if (input.environment !== undefined) patch.environment = input.environment
    if (input.realmId !== undefined) patch.realm_id = input.realmId
    if (input.companyName !== undefined) patch.company_name = input.companyName
    if (input.companyEmail !== undefined) patch.company_email = input.companyEmail
    if (input.country !== undefined) patch.country = input.country
    if (input.accessToken !== undefined) patch.access_token = input.accessToken
    if (input.refreshToken !== undefined) patch.refresh_token = input.refreshToken
    if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt?.toISOString() ?? null
    if (input.refreshExpiresAt !== undefined) patch.refresh_expires_at = input.refreshExpiresAt?.toISOString() ?? null
    if (input.lastSync !== undefined) patch.last_sync = input.lastSync?.toISOString() ?? null
    if (input.lastError !== undefined) patch.last_error = input.lastError
    if (input.baseCurrency !== undefined) patch.base_currency = input.baseCurrency
    if (input.timezone !== undefined) patch.timezone = input.timezone
    if (input.legalName !== undefined) patch.legal_name = input.legalName
    if (input.connectedAt !== undefined) patch.connected_at = input.connectedAt?.toISOString() ?? null
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.connections)
      .update(patch).eq('id', connectionId).eq('tenant_id', tenantId).select('*').single()
    if (error) throwPersistenceError(error)
    return connectionFromRow(data as Row)
  }

  async createLog(input: Omit<IntegrationLogRecord, 'id' | 'createdAt'>): Promise<IntegrationLogRecord> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.logs).insert({
      connection_id: input.connectionId,
      action: input.action,
      status: input.status,
      message: input.message,
      metadata: input.metadata,
    }).select('*').single()
    if (error) throwPersistenceError(error)
    return {
      id: String(data.id),
      connectionId: String(data.connection_id),
      action: String(data.action),
      status: String(data.status),
      message: (data.message as string | null) ?? null,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(String(data.created_at)),
    }
  }

  async createOAuthState(input: CreateOAuthStateInput): Promise<IntegrationOAuthStateRecord> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.oauthStates).insert({
      state_hash: input.stateHash,
      company_id: input.tenantId,
      provider_id: input.providerId,
      connection_id: input.connectionId,
      created_by: input.createdBy,
      expires_at: input.expiresAt.toISOString(),
    }).select('*').single()
    if (error) throwPersistenceError(error)
    return oauthStateFromRow(data as Row)
  }

  async findOAuthState(stateHash: string): Promise<IntegrationOAuthStateRecord | null> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.oauthStates)
      .select('*').eq('state_hash', stateHash).maybeSingle()
    if (error) throwPersistenceError(error)
    return data ? oauthStateFromRow(data as Row) : null
  }

  async consumeOAuthState(stateId: string, consumedAt: Date): Promise<IntegrationOAuthStateRecord | null> {
    const { data, error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.oauthStates)
      .update({ consumed_at: consumedAt.toISOString() })
      .eq('id', stateId)
      .is('consumed_at', null)
      .gt('expires_at', consumedAt.toISOString())
      .select('*')
      .maybeSingle()
    if (error) throwPersistenceError(error)
    return data ? oauthStateFromRow(data as Row) : null
  }

  async deleteOAuthState(stateId: string): Promise<void> {
    const { error } = await this.client.from(ACCOUNTING_INTEGRATION_TABLES.oauthStates).delete().eq('id', stateId)
    if (error) throwPersistenceError(error)
  }
}
