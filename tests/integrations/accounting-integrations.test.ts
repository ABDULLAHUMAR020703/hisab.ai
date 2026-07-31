import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AccountingProvider, ProviderCredentialContext } from '../../src/integrations/accounting/contracts/accounting-provider'
import type {
  CreateConnectionInput,
  CreateOAuthStateInput,
  IntegrationRepository,
  UpdateConnectionInput,
} from '../../src/integrations/accounting/contracts/repositories'
import {
  ConnectionStatus,
  Provider,
  type CompanyInfo,
  type IntegrationConnectionRecord,
  type IntegrationLogRecord,
  type IntegrationOAuthStateRecord,
  type IntegrationProviderRecord,
  type ProviderTokenSet,
} from '../../src/integrations/accounting/contracts/types'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import { AccountingIntegrationController } from '../../src/integrations/accounting/controllers/accounting-integration.controller'
import { ACCOUNTING_INTEGRATION_TABLES } from '../../src/integrations/accounting/repositories/accounting-integration-tables'
import { AccountingIntegrationService } from '../../src/integrations/accounting/services/accounting-integration.service'
import { AuditLogService } from '../../src/integrations/accounting/services/audit-log.service'
import { ConnectionService } from '../../src/integrations/accounting/services/connection.service'
import { hashOAuthState, OAuthStateService } from '../../src/integrations/accounting/services/oauth-state.service'
import { ProviderFactory } from '../../src/integrations/accounting/services/provider-factory'
import { TokenEncryptionService } from '../../src/integrations/accounting/services/token-encryption.service'
import { ConnectionValidationService } from '../../src/integrations/accounting/validators/connection-validation.service'
import {
  ConnectionAlreadyExistsException,
  ExpiredOAuthStateException,
  InvalidOAuthStateException,
  ProviderAuthenticationException,
  ProviderDisabledException,
  ProviderNotFoundException,
  UnauthorizedIntegrationException,
} from '../../src/integrations/accounting/utils/exceptions'
import {
  assertIntegrationPermission,
  hasIntegrationPermission,
  IntegrationPermission,
} from '../../src/integrations/accounting/middlewares/permissions'
import { integrationErrorLogContext } from '../../src/integrations/accounting/middlewares/error-logging'

const NOW = new Date('2026-07-29T00:00:00.000Z')
const HOUR = 60 * 60 * 1000

describe('Accounting integration persistence isolation', () => {
  it('uses only accounting-prefixed tables', () => {
    assert.deepEqual(ACCOUNTING_INTEGRATION_TABLES, {
      providers: 'accounting_integration_providers',
      connections: 'accounting_integration_connections',
      logs: 'accounting_integration_logs',
      oauthStates: 'accounting_integration_oauth_states',
    })
    const platformConnectionTable: string = 'integration_connections'
    assert.equal(Object.values(ACCOUNTING_INTEGRATION_TABLES).some((table) => table === platformConnectionTable), false)
  })

  it('creates only namespaced accounting tables without platform table DDL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/048_accounting_integrations_namespaced.sql'),
      'utf8',
    )

    for (const table of Object.values(ACCOUNTING_INTEGRATION_TABLES)) {
      assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}\\s*\\(`))
    }
    assert.doesNotMatch(
      migration,
      /(?:CREATE|ALTER|DROP) TABLE public\.integration_(?:connectors|connections)\b/,
    )
  })
})

describe('Accounting integration error logging', () => {
  it('preserves Supabase/PostgREST diagnostics without exposing secrets', () => {
    const diagnostic = integrationErrorLogContext({
      message: "Could not find the table 'public.integration_providers' in the schema cache",
      details: null,
      hint: "Perhaps you meant the table 'public.accounting_integration_providers'",
      code: 'PGRST205',
      body: {
        message: 'PostgREST failure',
        access_token: 'must-not-be-logged',
        clientSecret: 'must-not-be-logged',
        details: 'Authorization: Bearer must-not-be-logged',
      },
    })

    assert.equal(diagnostic.errorMessage, "Could not find the table 'public.integration_providers' in the schema cache")
    assert.equal(diagnostic.databaseErrorCode, 'PGRST205')
    assert.equal(diagnostic.supabaseErrorCode, 'PGRST205')
    assert.equal(diagnostic.supabaseErrorHint, "Perhaps you meant the table 'public.accounting_integration_providers'")
    assert.deepEqual(diagnostic.postgrestErrorBody, {
      message: 'PostgREST failure',
      access_token: '[REDACTED]',
      clientSecret: '[REDACTED]',
      details: 'Authorization: Bearer [REDACTED]',
    })
  })

  it('includes Error stacks in the structured context', () => {
    const diagnostic = integrationErrorLogContext(new Error('database unavailable'))
    assert.equal(diagnostic.error, 'database unavailable')
    assert.match(diagnostic.errorStack ?? '', /database unavailable/)
  })
})

function provider(slug = Provider.QUICKBOOKS, active = true): IntegrationProviderRecord {
  return { id: `provider-${slug}`, name: 'QuickBooks Online', slug, logo: null, isActive: active, createdAt: NOW, updatedAt: NOW }
}

function tokenSet(accessToken = 'plain-access', refreshToken = 'plain-refresh'): ProviderTokenSet {
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(NOW.getTime() + HOUR),
    refreshExpiresAt: new Date(NOW.getTime() + 100 * 24 * HOUR),
  }
}

class FakeRepository implements IntegrationRepository {
  providers: IntegrationProviderRecord[] = [provider()]
  connections: IntegrationConnectionRecord[] = []
  logs: IntegrationLogRecord[] = []
  states: IntegrationOAuthStateRecord[] = []

  async listProviders() { return this.providers }
  async findProviderBySlug(slug: Provider) { return this.providers.find((item) => item.slug === slug) ?? null }
  async findCurrentConnection(tenantId: string, providerId: string) {
    return [...this.connections].reverse().find((item) => item.tenantId === tenantId && item.providerId === providerId) ?? null
  }
  async findConnectionById(connectionId: string, tenantId: string) {
    return this.connections.find((item) => item.id === connectionId && item.tenantId === tenantId) ?? null
  }
  async createConnection(input: CreateConnectionInput) {
    const value: IntegrationConnectionRecord = {
      id: `connection-${this.connections.length + 1}`,
      tenantId: input.tenantId,
      providerId: input.providerId,
      status: input.status,
      realmId: null,
      companyName: null,
      companyEmail: null,
      country: null,
      accessToken: input.accessToken ?? null,
      refreshToken: input.refreshToken ?? null,
      expiresAt: null,
      refreshExpiresAt: input.refreshExpiresAt ?? null,
      lastSync: null,
      lastError: null,
      baseCurrency: null,
      timezone: null,
      legalName: null,
      connectedAt: null,
      connectedBy: input.connectedBy,
      createdAt: NOW,
      updatedAt: NOW,
    }
    this.connections.push(value)
    return value
  }
  async updateConnection(connectionId: string, tenantId: string, input: UpdateConnectionInput) {
    const value = await this.findConnectionById(connectionId, tenantId)
    if (!value) throw new Error('not found')
    Object.assign(value, input)
    return value
  }
  async createLog(input: Omit<IntegrationLogRecord, 'id' | 'createdAt'>) {
    const value = { ...input, id: `log-${this.logs.length + 1}`, createdAt: NOW }
    this.logs.push(value)
    return value
  }
  async createOAuthState(input: CreateOAuthStateInput) {
    const value: IntegrationOAuthStateRecord = {
      id: `state-${this.states.length + 1}`,
      stateHash: input.stateHash,
      tenantId: input.tenantId,
      providerId: input.providerId,
      connectionId: input.connectionId,
      createdBy: input.createdBy,
      createdAt: NOW,
      expiresAt: input.expiresAt,
      consumedAt: null,
    }
    this.states.push(value)
    return value
  }
  async findOAuthState(stateHash: string) {
    return this.states.find((item) => item.stateHash === stateHash) ?? null
  }
  async consumeOAuthState(stateId: string, consumedAt: Date) {
    const value = this.states.find((item) => item.id === stateId)
    if (!value || value.consumedAt || value.expiresAt <= consumedAt) return null
    value.consumedAt = consumedAt
    return value
  }
  async deleteOAuthState(stateId: string) {
    this.states = this.states.filter((item) => item.id !== stateId)
  }
}

class FakeProvider implements AccountingProvider {
  readonly slug = Provider.QUICKBOOKS
  connectCalls = 0
  exchangeCalls = 0
  refreshCalls = 0
  disconnectContext: ProviderCredentialContext | null = null
  tokens = tokenSet()
  refreshedTokens = tokenSet('refreshed-access', 'refreshed-refresh')
  company: CompanyInfo = {
    realmId: '123456', companyName: 'Acme LLC', companyEmail: 'books@acme.test', country: 'US',
    baseCurrency: 'USD', timezone: 'America/Los_Angeles', legalName: 'Acme Legal LLC',
  }

  async connect(context: { state: string }) {
    this.connectCalls += 1
    return { authorizationUrl: `https://appcenter.intuit.com/connect/oauth2?state=${context.state}` }
  }
  async exchangeAuthorizationCode() { this.exchangeCalls += 1; return this.tokens }
  async disconnect(context: ProviderCredentialContext) { this.disconnectContext = context }
  async refreshToken() { this.refreshCalls += 1; return this.refreshedTokens }
  async validateConnection() { return true }
  async getCompanyInfo() { return this.company }
  async getCustomers() { return [] }
  async getVendors() { return [] }
  async getInvoices() { return [] }
  async getBills() { return [] }
  async getPayments() { return [] }
  async getAccounts() { return [] }
  async getItems() { return [] }
  async getTaxCodes() { return [] }
  async getPaymentTerms() { return [] }
}

function fixture(repository = new FakeRepository(), adapter = new FakeProvider()) {
  const factory = new ProviderFactory([adapter])
  const encryption = new TokenEncryptionService('a-secure-test-secret-with-enough-length')
  const oauthStates = new OAuthStateService(repository, () => NOW)
  const connection = new ConnectionService(
    repository,
    factory,
    new ConnectionValidationService(),
    new AuditLogService(repository),
    encryption,
    oauthStates,
    () => NOW,
  )
  return {
    repository,
    adapter,
    factory,
    encryption,
    oauthStates,
    connection,
    service: new AccountingIntegrationService(repository, connection),
  }
}

async function startOAuth(connection: ConnectionService) {
  const result = await connection.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  return new URL(result.authorizationUrl).searchParams.get('state') ?? ''
}

describe('OAuth state', () => {
  it('generates random state and persists only its digest with ownership and expiry', async () => {
    const { oauthStates, repository } = fixture()
    const first = await oauthStates.create({ tenantId: 'tenant-1', providerId: 'provider-quickbooks', connectionId: 'connection-1', userId: 'user-1' })
    const second = await oauthStates.create({ tenantId: 'tenant-1', providerId: 'provider-quickbooks', connectionId: 'connection-1', userId: 'user-1' })
    assert.notEqual(first, second)
    assert.equal(repository.states[0].stateHash, hashOAuthState(first))
    assert.notEqual(repository.states[0].stateHash, first)
    assert.equal(repository.states[0].tenantId, 'tenant-1')
    assert.equal(repository.states[0].expiresAt.toISOString(), '2026-07-29T00:10:00.000Z')
  })

  it('rejects invalid and expired state', async () => {
    const { oauthStates, repository } = fixture()
    await assert.rejects(
      oauthStates.consume({ state: 'invalid', tenantId: 'tenant-1', providerId: 'provider-quickbooks', userId: 'user-1' }),
      InvalidOAuthStateException,
    )
    repository.states.push({
      id: 'expired', stateHash: hashOAuthState('expired-state'), tenantId: 'tenant-1', providerId: 'provider-quickbooks',
      connectionId: 'connection-1', createdBy: 'user-1', createdAt: new Date(NOW.getTime() - HOUR),
      expiresAt: new Date(NOW.getTime() - 1), consumedAt: null,
    })
    await assert.rejects(
      oauthStates.consume({ state: 'expired-state', tenantId: 'tenant-1', providerId: 'provider-quickbooks', userId: 'user-1' }),
      ExpiredOAuthStateException,
    )
  })
})

describe('ConnectionService OAuth lifecycle', () => {
  it('starts OAuth with a pending connection and provider authorization URL', async () => {
    const { connection, repository, adapter } = fixture()
    const state = await startOAuth(connection)
    assert.ok(state.length >= 40)
    assert.equal(repository.connections[0].status, ConnectionStatus.PENDING)
    assert.equal(repository.logs.some((item) => item.action === 'OAUTH_STARTED'), true)
    assert.equal(adapter.connectCalls, 1)
  })

  it('prevents duplicate pending connections', async () => {
    const { connection } = fixture()
    await startOAuth(connection)
    await assert.rejects(startOAuth(connection), ConnectionAlreadyExistsException)
  })

  it('completes a valid callback, encrypts tokens, and stores company information', async () => {
    const { connection, repository, adapter } = fixture()
    const state = await startOAuth(connection)
    const result = await connection.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, {
      state, code: 'authorization-code', realmId: '123456',
    })
    const stored = repository.connections[0]
    assert.equal(result.status, ConnectionStatus.CONNECTED)
    assert.equal(result.companyName, 'Acme LLC')
    assert.equal(result.baseCurrency, 'USD')
    assert.equal(stored.realmId, '123456')
    assert.match(stored.accessToken ?? '', /^v1\./)
    assert.match(stored.refreshToken ?? '', /^v1\./)
    assert.notEqual(stored.accessToken, adapter.tokens.accessToken)
    assert.equal(stored.connectedAt?.toISOString(), NOW.toISOString())
    assert.equal(repository.states.length, 0)
    assert.equal(repository.logs.some((item) => item.action === 'OAUTH_COMPLETED'), true)
  })

  it('refreshes expired access, stores rotated tokens, and retries authentication failures', async () => {
    const { connection, repository, adapter, encryption } = fixture()
    const state = await startOAuth(connection)
    await connection.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, { state, code: 'code', realmId: '123456' })
    repository.connections[0].expiresAt = new Date(NOW.getTime() - 1)
    let calls = 0
    const value = await connection.executeWithAccessToken('tenant-1', 'connection-1', Provider.QUICKBOOKS, async (context) => {
      calls += 1
      assert.equal(context.accessToken, 'refreshed-access')
      if (calls === 1) throw new ProviderAuthenticationException()
      return 'retried'
    })
    assert.equal(value, 'retried')
    assert.equal(adapter.refreshCalls, 2)
    assert.equal(encryption.decrypt(repository.connections[0].refreshToken ?? ''), 'refreshed-refresh')
    assert.equal(repository.logs.filter((item) => item.action === 'TOKEN_REFRESHED').length, 2)
  })

  it('revokes provider credentials, clears local company data, and keeps audit history', async () => {
    const { connection, repository, adapter } = fixture()
    const state = await startOAuth(connection)
    await connection.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, { state, code: 'code', realmId: '123456' })
    const result = await connection.disconnect('tenant-1', 'user-1', Provider.QUICKBOOKS)
    assert.equal(result.status, ConnectionStatus.DISCONNECTED)
    assert.equal(repository.connections[0].accessToken, null)
    assert.equal(repository.connections[0].refreshToken, null)
    assert.equal(repository.connections[0].realmId, null)
    assert.equal(adapter.disconnectContext?.refreshToken, 'plain-refresh')
    assert.equal(repository.logs.some((item) => item.action === 'CONNECTION_REMOVED'), true)
  })
})

describe('QuickBooks callback response', () => {
  it('returns a mutable NextResponse after a successful OAuth callback', async () => {
    const { service, connection } = fixture()
    const state = await startOAuth(connection)
    const controller = new AccountingIntegrationController(service)
    const response = await controller.quickBooksCallback(
      new Request(`https://hisab.test/api/integrations/quickbooks/callback?state=${state}&code=code&realmId=123456`),
      'tenant-1',
      'user-1',
    )

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('x-integration-result'), 'connected')
    assert.equal(response.headers.get('location'), 'https://hisab.test/settings/integrations?quickbooks=connected')
    assert.doesNotThrow(() => response.headers.set('x-correlation-id', 'test-correlation-id'))
    assert.equal(response.headers.get('x-correlation-id'), 'test-correlation-id')
  })
})

describe('QuickBooks provider', () => {
  const config = {
    clientId: 'client-id', clientSecret: 'client-secret',
    redirectUri: 'http://localhost:3000/api/integrations/quickbooks/callback', environment: 'sandbox' as const,
  }

  it('retrieves and maps company information from sandbox endpoints', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/companyinfo/')) {
        return Response.json({ CompanyInfo: {
          CompanyName: 'Sandbox Co', LegalName: 'Sandbox Legal Co', Country: 'US',
          Email: { Address: 'owner@sandbox.test' }, DefaultTimeZone: 'America/New_York',
        } })
      }
      return Response.json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'USD' } } } })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    const company = await providerService.getCompanyInfo({ accessToken: 'access', realmId: '123456' })
    assert.equal(company.companyName, 'Sandbox Co')
    assert.equal(company.baseCurrency, 'USD')
    assert.equal(company.timezone, 'America/New_York')
    assert.equal(urls.every((url) => url.startsWith('https://sandbox-quickbooks.api.intuit.com/')), true)
  })

  it('refreshes tokens using the OAuth token endpoint', async () => {
    let requestBody = ''
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body)
      return Response.json({
        access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600,
        x_refresh_token_expires_in: 8640000, token_type: 'bearer',
      })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    const tokens = await providerService.refreshToken('current-refresh')
    assert.equal(tokens.accessToken, 'new-access')
    assert.equal(tokens.refreshToken, 'new-refresh')
    assert.match(requestBody, /grant_type=refresh_token/)
    assert.match(requestBody, /refresh_token=current-refresh/)
  })

  it('queries QuickBooks resources through the paginated query endpoint', async () => {
    let requestUrl = ''
    const fetchImpl: typeof fetch = async (input) => {
      requestUrl = String(input)
      return Response.json({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Acme' }] } })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    const customers = await providerService.getCustomers({ accessToken: 'access', realmId: '123456' })
    assert.equal(customers.length, 1)
    const query = new URL(requestUrl).searchParams.get('query')
    assert.equal(query, 'SELECT * FROM Customer WHERE Active IN (true, false) STARTPOSITION 1 MAXRESULTS 1000')
  })

  it('continues pagination beyond the former 10,000-record ceiling', async () => {
    const positions: number[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const query = new URL(String(input)).searchParams.get('query') ?? ''
      const position = Number(query.match(/STARTPOSITION (\d+)/)?.[1] ?? 1)
      positions.push(position)
      const count = position <= 10001 ? (position === 10001 ? 1 : 1000) : 0
      return Response.json({ QueryResponse: { Invoice: Array.from({ length: count }, (_, index) => ({ Id: String(position + index) })) } })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    const invoices = await providerService.getInvoices({ accessToken:'access', realmId:'123456' })
    assert.equal(invoices.length, 10001)
    assert.equal(positions.includes(10001), true)
  })

  it('partitions historical transaction extraction and emits durable checkpoints', async () => {
    const queries: string[] = []
    const checkpoints: Array<{ partitionStart?:string; partitionEnd?:string }> = []
    const fetchImpl: typeof fetch = async input => {
      queries.push(new URL(String(input)).searchParams.get('query') ?? '')
      return Response.json({ QueryResponse:{} })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    await providerService.getEntityRecords({ accessToken:'access', realmId:'123456' }, 'Deposit', {
      partitioned:true,
      partitionStart:new Date('2000-01-01T00:00:00.000Z'),
      partitionEnd:new Date('2021-01-01T00:00:00.000Z'),
      onCheckpoint:async checkpoint => { checkpoints.push(checkpoint) },
    })
    assert.equal(queries.length, 3)
    assert.match(queries[0], /TxnDate >= '2000-01-01' AND TxnDate < '2010-01-01'/)
    assert.equal(checkpoints.length, 3)
  })

  it('fetches CDC changes with a 30-day safety window', async () => {
    let requestUrl = ''
    const fetchImpl: typeof fetch = async input => {
      requestUrl = String(input)
      return Response.json({ CDCResponse:[{ QueryResponse:{ Invoice:[{ Id:'9', SyncToken:'2' }] } }] })
    }
    const providerService = new QuickBooksIntegrationService(config, fetchImpl, () => NOW)
    const result = await providerService.getChangeData({ accessToken:'access', realmId:'123456' }, ['Invoice'], new Date('2020-01-01'))
    assert.equal(result.entities.Invoice.length, 1)
    const changedSince = new URL(requestUrl).searchParams.get('changedSince')
    assert.equal(changedSince, new Date(NOW.getTime() - 30 * 86400000).toISOString())
  })
})

describe('framework validation and permissions', () => {
  it('resolves registered providers and rejects missing adapters', () => {
    const adapter = new FakeProvider()
    const factory = new ProviderFactory([adapter])
    assert.equal(factory.get(Provider.QUICKBOOKS), adapter)
    assert.throws(() => factory.get(Provider.XERO), ProviderNotFoundException)
  })

  it('returns provider state without credentials', async () => {
    const { service, connection } = fixture()
    const state = await startOAuth(connection)
    await connection.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, { state, code: 'code', realmId: '123456' })
    const result = await service.list('tenant-1')
    assert.equal(result[0].connected, true)
    assert.equal(result[0].companyName, 'Acme LLC')
    assert.equal('accessToken' in result[0], false)
  })

  it('validates provider availability and tenant ownership', async () => {
    const validation = new ConnectionValidationService()
    assert.throws(() => validation.validateProvider(null, 'missing'), ProviderNotFoundException)
    assert.throws(() => validation.validateProviderActive(provider(Provider.XERO, false)), ProviderDisabledException)
    const repository = new FakeRepository()
    const connection = await repository.createConnection({ tenantId: 'tenant-1', providerId: 'provider', status: ConnectionStatus.PENDING, connectedBy: 'user' })
    assert.throws(() => validation.validateTenantOwnership(connection, 'tenant-2'), UnauthorizedIntegrationException)
  })

  it('allows owners and admins to manage while other roles can only view', () => {
    assert.equal(hasIntegrationPermission('OWNER', IntegrationPermission.MANAGE), true)
    assert.equal(hasIntegrationPermission('ADMIN', IntegrationPermission.CONNECT), true)
    assert.equal(hasIntegrationPermission('ACCOUNTANT', IntegrationPermission.VIEW), true)
    assert.equal(hasIntegrationPermission('ACCOUNTANT', IntegrationPermission.DISCONNECT), false)
    assert.throws(() => assertIntegrationPermission('EMPLOYEE', IntegrationPermission.CONNECT), UnauthorizedIntegrationException)
  })
})
