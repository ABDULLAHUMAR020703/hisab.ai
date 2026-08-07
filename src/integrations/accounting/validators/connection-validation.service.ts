import type { IntegrationConnectionRecord, IntegrationProviderRecord } from '../contracts/types'
import { ConnectionStatus } from '../contracts/types'
import {
  ConnectionAlreadyExistsException,
  ProviderDisabledException,
  ProviderNotFoundException,
  UnauthorizedIntegrationException,
} from '../utils/exceptions'

export class ConnectionValidationService {
  validateProvider(provider: IntegrationProviderRecord | null, slug: string): IntegrationProviderRecord {
    if (!provider) throw new ProviderNotFoundException(slug)
    return provider
  }

  validateProviderActive(provider: IntegrationProviderRecord): void {
    if (!provider.isActive) throw new ProviderDisabledException(provider.slug)
  }

  validateNoDuplicate(connection: IntegrationConnectionRecord | null): void {
    if (connection && [ConnectionStatus.PENDING, ConnectionStatus.CONNECTED].includes(connection.status)) {
      throw new ConnectionAlreadyExistsException()
    }
  }

  validateTenantOwnership(connection: IntegrationConnectionRecord, tenantId: string): void {
    if (connection.tenantId !== tenantId) throw new UnauthorizedIntegrationException('Connection does not belong to the active company.')
  }
}
