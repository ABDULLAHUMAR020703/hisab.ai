import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupabaseIntegrationRepository } from '../repositories/supabase-integration.repository'
import { QuickBooksIntegrationService } from '../providers/quickbooks/quickbooks-integration.service'
import { quickBooksConfigFromEnv } from '../providers/quickbooks/quickbooks-config'
import { AccountingIntegrationService } from './accounting-integration.service'
import { AuditLogService } from './audit-log.service'
import { ConnectionService } from './connection.service'
import { ProviderFactory } from './provider-factory'
import { TokenEncryptionService } from './token-encryption.service'
import { ConnectionValidationService } from '../validators/connection-validation.service'
import { OAuthStateService } from './oauth-state.service'

export function createAccountingIntegrationService(): AccountingIntegrationService {
  const repository = new SupabaseIntegrationRepository(createAdminClient())
  const providers = new ProviderFactory([new QuickBooksIntegrationService(quickBooksConfigFromEnv())])
  const secret = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ?? process.env.APP_SECRET
  if (!secret) throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY or APP_SECRET must be configured.')
  const connections = new ConnectionService(
    repository,
    providers,
    new ConnectionValidationService(),
    new AuditLogService(repository),
    new TokenEncryptionService(secret),
    new OAuthStateService(repository),
  )
  return new AccountingIntegrationService(repository, connections)
}
