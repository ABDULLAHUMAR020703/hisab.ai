import type { IntegrationRepository, UpdateConnectionInput } from '../contracts/repositories'
import {
  ConnectionStatus,
  type ConnectionStatusDto,
  type IntegrationConnectionRecord,
  type Provider,
  type ProviderTokenSet,
} from '../contracts/types'
import {
  ConnectionAlreadyExistsException,
  ConnectionNotFoundException,
  InvalidOAuthCallbackException,
  ProviderAuthenticationException,
} from '../utils/exceptions'
import { ConnectionValidationService } from '../validators/connection-validation.service'
import { AuditLogService } from './audit-log.service'
import { OAuthStateService } from './oauth-state.service'
import { ProviderFactory } from './provider-factory'
import { TokenEncryptionService } from './token-encryption.service'

const EXPIRY_SKEW_MS = 30_000

export interface OAuthCallbackInput {
  state: string
  code?: string | null
  realmId?: string | null
  providerError?: string | null
}

export class ConnectionService {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly providerFactory: ProviderFactory,
    private readonly validation: ConnectionValidationService,
    private readonly audit: AuditLogService,
    private readonly encryption: TokenEncryptionService,
    private readonly oauthStates: OAuthStateService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getStatus(tenantId: string, slug: Provider): Promise<ConnectionStatusDto> {
    const provider = this.validation.validateProvider(await this.repository.findProviderBySlug(slug), slug)
    const connection = await this.repository.findCurrentConnection(tenantId, provider.id)
    if (!connection) return this.emptyStatus()
    return this.toStatusDto(connection)
  }

  async beginConnection(tenantId: string, userId: string, slug: Provider): Promise<{ authorizationUrl: string }> {
    const providerRecord = this.validation.validateProvider(await this.repository.findProviderBySlug(slug), slug)
    this.validation.validateProviderActive(providerRecord)
    const current = await this.repository.findCurrentConnection(tenantId, providerRecord.id)

    if (current && [ConnectionStatus.PENDING, ConnectionStatus.CONNECTED].includes(current.status)) {
      await this.audit.record({
        connectionId: current.id,
        action: 'OAUTH_FAILED',
        status: current.status,
        message: 'Duplicate connection attempt rejected.',
        metadata: { provider: slug, tenantId, userId, reason: 'duplicate_connection' },
      })
      throw new ConnectionAlreadyExistsException()
    }

    if (current && current.status !== ConnectionStatus.DISCONNECTED) {
      if (current.accessToken || current.refreshToken) {
        try {
          await this.providerFactory.get(slug).disconnect({
            accessToken: this.decryptOptional(current.accessToken),
            refreshToken: this.decryptOptional(current.refreshToken),
            realmId: current.realmId,
          })
        } catch {
          // Reauthorization can continue after local credential removal.
        }
      }
      await this.repository.updateConnection(current.id, tenantId, this.clearedConnection())
    }

    const connection = await this.repository.createConnection({
      tenantId,
      providerId: providerRecord.id,
      status: ConnectionStatus.PENDING,
      connectedBy: userId,
    })

    try {
      const state = await this.oauthStates.create({
        tenantId,
        providerId: providerRecord.id,
        connectionId: connection.id,
        userId,
      })
      const result = await this.providerFactory.get(slug).connect({ tenantId, userId, state })
      await this.audit.record({
        connectionId: connection.id,
        action: 'CONNECTION_CREATED',
        status: ConnectionStatus.PENDING,
        message: 'OAuth connection lifecycle created.',
        metadata: { provider: slug, tenantId, userId },
      })
      await this.audit.record({
        connectionId: connection.id,
        action: 'OAUTH_STARTED',
        status: ConnectionStatus.PENDING,
        message: 'User redirected to provider authorization.',
        metadata: { provider: slug, tenantId, userId },
      })
      return result
    } catch (error) {
      await this.failConnection(connection, tenantId, slug, userId, 'OAuth initialization failed.', error)
      throw error
    }
  }

  async completeOAuth(
    tenantId: string,
    userId: string,
    slug: Provider,
    input: OAuthCallbackInput,
  ): Promise<ConnectionStatusDto> {
    const providerRecord = this.validation.validateProvider(await this.repository.findProviderBySlug(slug), slug)
    this.validation.validateProviderActive(providerRecord)
    const state = await this.oauthStates.consume({
      state: input.state,
      tenantId,
      providerId: providerRecord.id,
      userId,
    })
    const connection = await this.repository.findConnectionById(state.connectionId, tenantId)
    if (!connection) throw new ConnectionNotFoundException()
    this.validation.validateTenantOwnership(connection, tenantId)
    if (connection.status !== ConnectionStatus.PENDING || connection.connectedBy !== userId) {
      await this.audit.record({
        connectionId: connection.id,
        action: 'OAUTH_FAILED',
        status: connection.status,
        message: 'OAuth callback rejected because the connection lifecycle is no longer pending.',
        metadata: { provider: slug, tenantId, userId, reason: 'connection_not_pending' },
      })
      throw new InvalidOAuthCallbackException('The connection request is no longer pending.')
    }

    let issuedTokens: ProviderTokenSet | null = null
    try {
      if (input.providerError) throw new InvalidOAuthCallbackException('QuickBooks authorization was denied or cancelled.')
      if (!input.code || input.code.length > 512 || !input.realmId || !/^\d{1,64}$/.test(input.realmId)) {
        throw new InvalidOAuthCallbackException()
      }
      const provider = this.providerFactory.get(slug)
      issuedTokens = await provider.exchangeAuthorizationCode({ code: input.code, realmId: input.realmId })
      const company = await provider.getCompanyInfo({ accessToken: issuedTokens.accessToken, realmId: input.realmId })
      const connectedAt = this.now()
      const connected = await this.repository.updateConnection(connection.id, tenantId, {
        ...this.encryptedTokens(issuedTokens),
        status: ConnectionStatus.CONNECTED,
        realmId: input.realmId,
        companyName: company.companyName,
        companyEmail: company.companyEmail,
        country: company.country,
        baseCurrency: company.baseCurrency,
        timezone: company.timezone,
        legalName: company.legalName,
        connectedAt,
        lastError: null,
      })
      await this.repository.deleteOAuthState(state.id)
      await this.audit.record({
        connectionId: connection.id,
        action: 'OAUTH_COMPLETED',
        status: ConnectionStatus.CONNECTED,
        message: 'QuickBooks OAuth completed successfully.',
        metadata: { provider: slug, tenantId, userId, realmId: input.realmId },
      })
      await this.audit.record({
        connectionId: connection.id,
        action: 'CONNECTION_CONNECTED',
        status: ConnectionStatus.CONNECTED,
        message: 'Provider company information stored.',
        metadata: { provider: slug, tenantId, userId, realmId: input.realmId },
      })
      return this.toStatusDto(connected)
    } catch (error) {
      if (issuedTokens) {
        try {
          await this.providerFactory.get(slug).disconnect({
            accessToken: issuedTokens.accessToken,
            refreshToken: issuedTokens.refreshToken,
            realmId: input.realmId ?? null,
          })
        } catch {
          // Preserve the original callback failure; no credentials are stored locally.
        }
      }
      await this.failConnection(connection, tenantId, slug, userId, 'OAuth callback failed.', error)
      throw error
    }
  }

  async disconnect(tenantId: string, userId: string, slug: Provider): Promise<ConnectionStatusDto> {
    const providerRecord = this.validation.validateProvider(await this.repository.findProviderBySlug(slug), slug)
    const connection = await this.repository.findCurrentConnection(tenantId, providerRecord.id)
    if (!connection || connection.status === ConnectionStatus.DISCONNECTED) throw new ConnectionNotFoundException()
    this.validation.validateTenantOwnership(connection, tenantId)

    let remoteRevoked = true
    try {
      await this.providerFactory.get(slug).disconnect({
        accessToken: this.decryptOptional(connection.accessToken),
        refreshToken: this.decryptOptional(connection.refreshToken),
        realmId: connection.realmId,
      })
    } catch {
      // Local credential removal must succeed even if Intuit is unavailable.
      remoteRevoked = false
    }

    const disconnected = await this.repository.updateConnection(connection.id, tenantId, {
      ...this.clearedConnection(),
      lastError: remoteRevoked ? null : 'Remote token revocation could not be confirmed.',
    })
    await this.audit.record({
      connectionId: connection.id,
      action: 'CONNECTION_REMOVED',
      status: ConnectionStatus.DISCONNECTED,
      message: remoteRevoked
        ? 'Provider disconnected, remote authorization revoked, and local credentials removed.'
        : 'Provider disconnected and local credentials removed; remote revocation was unavailable.',
      metadata: { provider: slug, tenantId, userId, remoteRevoked },
    })
    return this.toStatusDto(disconnected)
  }

  async storeTokens(tenantId: string, connectionId: string, tokens: ProviderTokenSet): Promise<void> {
    const connection = await this.repository.findConnectionById(connectionId, tenantId)
    if (!connection) throw new ConnectionNotFoundException()
    this.validation.validateTenantOwnership(connection, tenantId)
    await this.repository.updateConnection(connectionId, tenantId, this.encryptedTokens(tokens))
  }

  async executeWithAccessToken<T>(
    tenantId: string,
    connectionId: string,
    slug: Provider,
    operation: (context: { accessToken: string; realmId: string }) => Promise<T>,
  ): Promise<T> {
    let connection = await this.requireConnectedConnection(tenantId, connectionId)
    if (!connection.expiresAt || connection.expiresAt.getTime() <= this.now().getTime() + EXPIRY_SKEW_MS) {
      connection = await this.refreshConnection(tenantId, connection, slug)
    }
    try {
      return await operation(this.accessContext(connection))
    } catch (error) {
      if (!(error instanceof ProviderAuthenticationException)) throw error
      connection = await this.refreshConnection(tenantId, connection, slug)
      return operation(this.accessContext(connection))
    }
  }

  async executeForProvider<T>(
    tenantId: string,
    slug: Provider,
    operation: (context: { accessToken: string; realmId: string }) => Promise<T>,
  ): Promise<T> {
    const provider = this.validation.validateProvider(await this.repository.findProviderBySlug(slug), slug)
    this.validation.validateProviderActive(provider)
    const connection = await this.repository.findCurrentConnection(tenantId, provider.id)
    if (!connection) throw new ConnectionNotFoundException()
    return this.executeWithAccessToken(tenantId, connection.id, slug, operation)
  }

  private async refreshConnection(
    tenantId: string,
    connection: IntegrationConnectionRecord,
    slug: Provider,
  ): Promise<IntegrationConnectionRecord> {
    if (!connection.refreshToken || (connection.refreshExpiresAt && connection.refreshExpiresAt <= this.now())) {
      await this.repository.updateConnection(connection.id, tenantId, {
        status: ConnectionStatus.TOKEN_EXPIRED,
        lastError: 'QuickBooks refresh token has expired.',
      })
      throw new ProviderAuthenticationException('QuickBooks must be reconnected.')
    }
    try {
      const tokens = await this.providerFactory.get(slug).refreshToken(this.encryption.decrypt(connection.refreshToken))
      const refreshed = await this.repository.updateConnection(connection.id, tenantId, {
        ...this.encryptedTokens(tokens),
        status: ConnectionStatus.CONNECTED,
        lastError: null,
      })
      await this.audit.record({
        connectionId: connection.id,
        action: 'TOKEN_REFRESHED',
        status: ConnectionStatus.CONNECTED,
        message: 'Provider access token refreshed.',
        metadata: { provider: slug, tenantId },
      })
      return refreshed
    } catch (error) {
      if (error instanceof ProviderAuthenticationException) {
        await this.repository.updateConnection(connection.id, tenantId, {
          status: ConnectionStatus.TOKEN_EXPIRED,
          lastError: 'QuickBooks refresh token was rejected.',
        })
      }
      throw error
    }
  }

  private encryptedTokens(tokens: ProviderTokenSet): UpdateConnectionInput {
    return {
      accessToken: this.encryption.encrypt(tokens.accessToken),
      refreshToken: this.encryption.encrypt(tokens.refreshToken),
      expiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    }
  }

  private async requireConnectedConnection(tenantId: string, connectionId: string) {
    const connection = await this.repository.findConnectionById(connectionId, tenantId)
    if (!connection || connection.status !== ConnectionStatus.CONNECTED || !connection.realmId || !connection.accessToken) {
      throw new ConnectionNotFoundException()
    }
    return connection
  }

  private accessContext(connection: IntegrationConnectionRecord) {
    if (!connection.realmId || !connection.accessToken) throw new ConnectionNotFoundException()
    return { realmId: connection.realmId, accessToken: this.encryption.decrypt(connection.accessToken) }
  }

  private decryptOptional(value: string | null): string | null {
    return value ? this.encryption.decrypt(value) : null
  }

  private clearedConnection(): UpdateConnectionInput {
    return {
      status: ConnectionStatus.DISCONNECTED,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null,
      realmId: null,
      companyName: null,
      companyEmail: null,
      country: null,
      baseCurrency: null,
      timezone: null,
      legalName: null,
      connectedAt: null,
      lastError: null,
    }
  }

  private async failConnection(
    connection: IntegrationConnectionRecord,
    tenantId: string,
    slug: Provider,
    userId: string,
    message: string,
    error: unknown,
  ) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown provider error'
    await this.repository.updateConnection(connection.id, tenantId, {
      status: ConnectionStatus.FAILED,
      lastError: errorMessage,
    })
    await this.audit.record({
      connectionId: connection.id,
      action: 'OAUTH_FAILED',
      status: ConnectionStatus.FAILED,
      message,
      metadata: { provider: slug, tenantId, userId, error: errorMessage },
    })
  }

  private toStatusDto(connection: IntegrationConnectionRecord): ConnectionStatusDto {
    return {
      connected: connection.status === ConnectionStatus.CONNECTED,
      companyName: connection.companyName,
      companyEmail: connection.companyEmail,
      country: connection.country,
      lastSync: connection.lastSync?.toISOString() ?? null,
      realmId: connection.realmId,
      baseCurrency: connection.baseCurrency,
      timezone: connection.timezone,
      legalName: connection.legalName,
      connectedAt: connection.connectedAt?.toISOString() ?? null,
      status: connection.status,
    }
  }

  private emptyStatus(): ConnectionStatusDto {
    return {
      connected: false,
      companyName: null,
      companyEmail: null,
      country: null,
      lastSync: null,
      realmId: null,
      baseCurrency: null,
      timezone: null,
      legalName: null,
      connectedAt: null,
      status: ConnectionStatus.NOT_CONNECTED,
    }
  }
}
