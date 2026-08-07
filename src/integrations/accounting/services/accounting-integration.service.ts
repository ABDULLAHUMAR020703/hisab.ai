import type { IntegrationRepository } from '../contracts/repositories'
import type { Provider } from '../contracts/types'
import { ConnectionService } from './connection.service'

export class AccountingIntegrationService {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly connections: ConnectionService,
  ) {}

  async list(tenantId: string) {
    const providers = await this.repository.listProviders()
    return Promise.all(providers.map(async (provider) => {
      const status = await this.connections.getStatus(tenantId, provider.slug)
      return {
        provider: provider.slug,
        name: provider.name,
        logo: provider.logo,
        isActive: provider.isActive,
        connected: status.connected,
        status: status.status,
        companyName: status.companyName,
        lastSync: status.lastSync,
        realmId: status.realmId,
        companyEmail: status.companyEmail,
        country: status.country,
        baseCurrency: status.baseCurrency,
        timezone: status.timezone,
        legalName: status.legalName,
        connectedAt: status.connectedAt,
      }
    }))
  }

  getStatus(tenantId: string, provider: Provider) {
    return this.connections.getStatus(tenantId, provider)
  }

  connect(tenantId: string, userId: string, provider: Provider) {
    return this.connections.beginConnection(tenantId, userId, provider)
  }

  disconnect(tenantId: string, userId: string, provider: Provider) {
    return this.connections.disconnect(tenantId, userId, provider)
  }

  completeOAuth(tenantId: string, userId: string, provider: Provider, input: import('./connection.service').OAuthCallbackInput) {
    return this.connections.completeOAuth(tenantId, userId, provider, input)
  }
}
