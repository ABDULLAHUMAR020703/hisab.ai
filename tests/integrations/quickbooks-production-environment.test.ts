import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
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
import {
  assertQuickBooksConnectionEnvironment,
  quickBooksConfigFromEnv,
  quickBooksEndpoints,
  resolveQuickBooksEnvironment,
  resolveStoredConnectionEnvironment,
} from '../../src/integrations/accounting/providers/quickbooks/quickbooks-config'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import { ConnectionService } from '../../src/integrations/accounting/services/connection.service'
import { OAuthStateService } from '../../src/integrations/accounting/services/oauth-state.service'
import { ProviderFactory } from '../../src/integrations/accounting/services/provider-factory'
import { TokenEncryptionService } from '../../src/integrations/accounting/services/token-encryption.service'
import { AuditLogService } from '../../src/integrations/accounting/services/audit-log.service'
import { ConnectionValidationService } from '../../src/integrations/accounting/validators/connection-validation.service'
import {
  SandboxConnectionNotAllowedException,
} from '../../src/integrations/accounting/utils/exceptions'

const NOW = new Date('2026-08-14T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function tokenSet(access = 'access', refresh = 'refresh'): ProviderTokenSet {
  return {
    accessToken: access,
    refreshToken: refresh,
    accessExpiresAt: new Date(NOW.getTime() + HOUR),
    refreshExpiresAt: new Date(NOW.getTime() + 30 * HOUR),
  }
}

class MemoryRepository implements IntegrationRepository {
  providers: IntegrationProviderRecord[] = [{
    id: 'provider-1',
    name: 'QuickBooks Online',
    slug: Provider.QUICKBOOKS,
    logo: '/integrations/quickbooks.svg',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  }]
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
      environment: null,
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
  constructor(readonly environment: 'sandbox' | 'production' = 'sandbox') {}
  async connect(context: { state: string }) {
    return { authorizationUrl: `https://appcenter.intuit.com/connect/oauth2?state=${context.state}` }
  }
  async exchangeAuthorizationCode() { return tokenSet() }
  async disconnect(_context: ProviderCredentialContext) {}
  async refreshToken() { return tokenSet('refreshed-access', 'refreshed-refresh') }
  async validateConnection() { return true }
  async getCompanyInfo(): Promise<CompanyInfo> {
    return {
      realmId: '999888',
      companyName: this.environment === 'production' ? 'Prod Co' : 'Sandbox Co',
      companyEmail: 'owner@example.test',
      country: 'US',
      baseCurrency: 'USD',
      timezone: 'America/New_York',
      legalName: 'Legal Co',
    }
  }
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

function buildConnectionService(environment: 'sandbox' | 'production') {
  const repository = new MemoryRepository()
  const provider = new FakeProvider(environment)
  const encryption = new TokenEncryptionService('test-encryption-key-32-characters!!')
  const connections = new ConnectionService(
    repository,
    new ProviderFactory([provider]),
    new ConnectionValidationService(),
    new AuditLogService(repository),
    encryption,
    new OAuthStateService(repository),
    () => NOW,
    () => environment,
  )
  return { repository, connections, encryption }
}

test('sandbox connection is detected as sandbox (including legacy null)', () => {
  assert.equal(resolveStoredConnectionEnvironment('sandbox'), 'sandbox')
  assert.equal(resolveStoredConnectionEnvironment(null), 'sandbox')
  assert.equal(resolveStoredConnectionEnvironment(undefined), 'sandbox')
})

test('production connection is detected as production', () => {
  assert.equal(resolveStoredConnectionEnvironment('production'), 'production')
})

test('production OAuth uses the shared Intuit authorization host (env selects API only)', async () => {
  const service = new QuickBooksIntegrationService({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://hisab.test/callback',
    environment: 'production',
  })
  const result = await service.connect({ tenantId: 't', userId: 'u', state: 'state-1' })
  const url = new URL(result.authorizationUrl)
  assert.equal(url.origin, 'https://appcenter.intuit.com')
  assert.equal(url.pathname, '/connect/oauth2')
  assert.equal(service.environment, 'production')
})

test('production API requests use the production API endpoint', async () => {
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input))
    if (String(input).includes('/companyinfo/')) {
      return Response.json({ CompanyInfo: { CompanyName: 'Prod Co', Country: 'US' } })
    }
    return Response.json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'USD' } } } })
  }
  const service = new QuickBooksIntegrationService({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://hisab.test/callback',
    environment: 'production',
  }, fetchImpl, () => NOW)
  await service.getCompanyInfo({ accessToken: 'access', realmId: '123' })
  assert.equal(quickBooksEndpoints('production').api, 'https://quickbooks.api.intuit.com')
  assert.ok(urls.every((url) => url.startsWith('https://quickbooks.api.intuit.com/')))
})

test('sandbox credentials cannot be used by a production migration', () => {
  assert.throws(
    () => assertQuickBooksConnectionEnvironment({
      connectionEnvironment: 'sandbox',
      processEnvironment: 'production',
      forMigration: true,
    }),
    (error: unknown) => error instanceof SandboxConnectionNotAllowedException
      && error.code === 'QUICKBOOKS_SANDBOX_CONNECTION'
      && /Sandbox company/.test(error.message),
  )
  assert.throws(
    () => assertQuickBooksConnectionEnvironment({
      connectionEnvironment: null,
      processEnvironment: 'production',
      forMigration: true,
    }),
    SandboxConnectionNotAllowedException,
  )
})

test('production migration gate accepts a production connection', async () => {
  const { connections, repository, encryption } = buildConnectionService('production')
  const pending = await repository.createConnection({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    status: ConnectionStatus.PENDING,
    connectedBy: 'user-1',
  })
  const tokens = tokenSet()
  await repository.updateConnection(pending.id, 'tenant-1', {
    status: ConnectionStatus.CONNECTED,
    environment: 'production',
    realmId: '999888',
    companyName: 'Prod Co',
    accessToken: encryption.encrypt(tokens.accessToken),
    refreshToken: encryption.encrypt(tokens.refreshToken),
    expiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  })

  const status = await connections.assertMigrationConnectionReady('tenant-1', Provider.QUICKBOOKS)
  assert.equal(status.environment, 'production')
  assert.equal(status.serverEnvironment, 'production')
  assert.equal(status.productionReady, true)
  assert.equal(status.companyName, 'Prod Co')
})

test('migration refuses to start when only a sandbox connection exists on a production server', async () => {
  const { connections, repository, encryption } = buildConnectionService('production')
  const pending = await repository.createConnection({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    status: ConnectionStatus.PENDING,
    connectedBy: 'user-1',
  })
  const tokens = tokenSet()
  await repository.updateConnection(pending.id, 'tenant-1', {
    status: ConnectionStatus.CONNECTED,
    environment: 'sandbox',
    realmId: '111',
    companyName: 'Sandbox Co',
    accessToken: encryption.encrypt(tokens.accessToken),
    refreshToken: encryption.encrypt(tokens.refreshToken),
    expiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  })

  await assert.rejects(
    () => connections.assertMigrationConnectionReady('tenant-1', Provider.QUICKBOOKS),
    (error: unknown) => error instanceof SandboxConnectionNotAllowedException,
  )
  await assert.rejects(
    () => connections.executeForProvider('tenant-1', Provider.QUICKBOOKS, async () => 'ok'),
    SandboxConnectionNotAllowedException,
  )
})

test('OAuth complete persists the process environment on the connection', async () => {
  const { connections, repository } = buildConnectionService('production')
  const started = await connections.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  const state = new URL(started.authorizationUrl).searchParams.get('state')
  assert.ok(state)
  const status = await connections.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, {
    state,
    code: 'auth-code',
    realmId: '999888',
  })
  assert.equal(status.environment, 'production')
  assert.equal(status.serverEnvironment, 'production')
  assert.equal(status.productionReady, true)
  assert.equal(repository.connections.at(-1)?.environment, 'production')
})

test('token refresh works for production credentials without changing environment', async () => {
  const { connections, repository, encryption } = buildConnectionService('production')
  const pending = await repository.createConnection({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    status: ConnectionStatus.PENDING,
    connectedBy: 'user-1',
  })
  const tokens = tokenSet()
  await repository.updateConnection(pending.id, 'tenant-1', {
    status: ConnectionStatus.CONNECTED,
    environment: 'production',
    realmId: '999888',
    companyName: 'Prod Co',
    accessToken: encryption.encrypt(tokens.accessToken),
    refreshToken: encryption.encrypt(tokens.refreshToken),
    expiresAt: new Date(NOW.getTime() - 1_000),
    refreshExpiresAt: tokens.refreshExpiresAt,
  })

  const result = await connections.executeForProvider('tenant-1', Provider.QUICKBOOKS, async (context) => context.realmId)
  assert.equal(result, '999888')
  assert.equal(repository.connections.at(-1)?.environment, 'production')
})

test('Settings status DTO exposes Production vs Sandbox clearly', async () => {
  const production = buildConnectionService('production')
  const started = await production.connections.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  const state = new URL(started.authorizationUrl).searchParams.get('state')!
  const status = await production.connections.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, {
    state,
    code: 'code',
    realmId: '999888',
  })
  assert.equal(status.environment, 'production')
  assert.equal(status.serverEnvironment, 'production')
  assert.equal(status.productionReady, true)
  assert.equal(status.environmentMismatch, false)

  const sandbox = buildConnectionService('sandbox')
  const sandboxStarted = await sandbox.connections.beginConnection('tenant-2', 'user-1', Provider.QUICKBOOKS)
  const sandboxState = new URL(sandboxStarted.authorizationUrl).searchParams.get('state')!
  const sandboxStatus = await sandbox.connections.completeOAuth('tenant-2', 'user-1', Provider.QUICKBOOKS, {
    state: sandboxState,
    code: 'code',
    realmId: '111',
  })
  assert.equal(sandboxStatus.environment, 'sandbox')
  assert.equal(sandboxStatus.serverEnvironment, 'sandbox')
  assert.equal(sandboxStatus.productionReady, false)
})

test('existing sandbox functionality remains available for development/testing', async () => {
  assert.equal(resolveQuickBooksEnvironment({ NODE_ENV: 'development' }), 'sandbox')
  assert.equal(resolveQuickBooksEnvironment({ NODE_ENV: 'test' }), 'sandbox')
  assert.equal(resolveQuickBooksEnvironment({ NODE_ENV: 'production' }), 'production')
  assert.equal(resolveQuickBooksEnvironment({ NODE_ENV: 'production', QB_ENVIRONMENT: 'sandbox' }), 'sandbox')
  assert.equal(quickBooksEndpoints('sandbox').api, 'https://sandbox-quickbooks.api.intuit.com')

  const { connections } = buildConnectionService('sandbox')
  const started = await connections.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  const state = new URL(started.authorizationUrl).searchParams.get('state')!
  await connections.completeOAuth('tenant-1', 'user-1', Provider.QUICKBOOKS, {
    state,
    code: 'code',
    realmId: '111',
  })
  const realm = await connections.executeForProvider('tenant-1', Provider.QUICKBOOKS, async (context) => context.realmId)
  assert.equal(realm, '111')
  // Local sandbox migrations are allowed when the process itself is sandbox.
  const ready = await connections.assertMigrationConnectionReady('tenant-1', Provider.QUICKBOOKS)
  assert.equal(ready.environment, 'sandbox')
  assert.equal(ready.productionReady, false)
})

test('QB_ENVIRONMENT unset defaults from NODE_ENV and validates explicit values', () => {
  assert.equal(resolveQuickBooksEnvironment({}), 'sandbox')
  assert.throws(() => resolveQuickBooksEnvironment({ QB_ENVIRONMENT: 'staging' }), /QB_ENVIRONMENT/)
  const config = quickBooksConfigFromEnv({
    QB_CLIENT_ID: 'id',
    QB_CLIENT_SECRET: 'secret',
    QB_REDIRECT_URI: 'https://hisab.test/callback',
    NODE_ENV: 'production',
  })
  assert.equal(config.environment, 'production')
})

test('Reconnect to Production is allowed when a sandbox connection is already connected', async () => {
  const { connections, repository } = buildConnectionService('production')
  const started = await connections.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  // Force a sandbox-labeled connection while the server is production.
  const connection = repository.connections.at(-1)!
  await repository.updateConnection(connection.id, 'tenant-1', {
    status: ConnectionStatus.CONNECTED,
    environment: 'sandbox',
    realmId: '111',
    companyName: 'Sandbox Co',
  })

  const reconnect = await connections.beginConnection('tenant-1', 'user-1', Provider.QUICKBOOKS)
  assert.match(reconnect.authorizationUrl, /appcenter\.intuit\.com/)
  assert.equal(repository.connections.filter((row) => row.status === ConnectionStatus.DISCONNECTED).length >= 1, true)
})

test('migration schema persists connection environment and UI/docs mention Production', () => {
  const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/065_quickbooks_connection_environment.sql'), 'utf8')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS environment TEXT/)
  assert.match(migration, /environment IN \('sandbox', 'production'\)/)

  const integrationsUi = readFileSync(resolve(process.cwd(), 'src/app/(dashboard)/settings/integrations/integrations-client.tsx'), 'utf8')
  assert.match(integrationsUi, /Reconnect to Production/)
  assert.match(integrationsUi, /Production/)
  assert.match(integrationsUi, /Sandbox/)

  const wizard = readFileSync(resolve(process.cwd(), 'src/components/import-export/steps/ConnectedSourceFlow.tsx'), 'utf8')
  assert.match(wizard, /Ready to migrate/)
  assert.match(wizard, /Environment:/)

  const sessionService = readFileSync(resolve(process.cwd(), 'src/lib/import-export/wizard/migration-session.service.ts'), 'utf8')
  assert.match(sessionService, /assertMigrationConnectionReady/)

  const coolify = readFileSync(resolve(process.cwd(), 'COOLIFY_QUICKBOOKS_WORKER.md'), 'utf8')
  assert.match(coolify, /QB_ENVIRONMENT=production/)
})

test('no hard-coded sandbox API host remains in the QuickBooks provider client construction path', () => {
  const config = readFileSync(resolve(process.cwd(), 'src/integrations/accounting/providers/quickbooks/quickbooks-config.ts'), 'utf8')
  assert.match(config, /resolveQuickBooksEnvironment/)
  assert.match(config, /sandbox-quickbooks\.api\.intuit\.com/)
  assert.match(config, /quickbooks\.api\.intuit\.com/)
  assert.match(config, /NODE_ENV === 'production'/)

  const service = readFileSync(resolve(process.cwd(), 'src/integrations/accounting/providers/quickbooks/quickbooks-integration.service.ts'), 'utf8')
  assert.match(service, /quickBooksEndpoints\(config\.environment\)/)
  assert.doesNotMatch(service, /sandbox-quickbooks\.api\.intuit\.com/)
})
