import 'server-only'
import { AccountingIntegrationController } from '../controllers/accounting-integration.controller'
import { integrationApiHandler } from '../middlewares/api-handler'
import { IntegrationPermission } from '../middlewares/permissions'
import { createAccountingIntegrationService } from '../services/container'

function controller() {
  return new AccountingIntegrationController(createAccountingIntegrationService())
}

export const listIntegrations = integrationApiHandler(
  'GET /api/integrations',
  IntegrationPermission.VIEW,
  ({ tenantId }) => controller().list(tenantId),
)

export const getQuickBooksStatus = integrationApiHandler(
  'GET /api/integrations/quickbooks/status',
  IntegrationPermission.VIEW,
  ({ tenantId }) => controller().quickBooksStatus(tenantId),
)

export const connectQuickBooks = integrationApiHandler(
  'POST /api/integrations/quickbooks/connect',
  IntegrationPermission.CONNECT,
  ({ tenantId, user }) => controller().connectQuickBooks(tenantId, user.id),
)

export const quickBooksCallback = integrationApiHandler(
  'GET /api/integrations/quickbooks/callback',
  IntegrationPermission.MANAGE,
  ({ request, tenantId, user }) => controller().quickBooksCallback(request, tenantId, user.id),
)

export const disconnectQuickBooks = integrationApiHandler(
  'POST /api/integrations/quickbooks/disconnect',
  IntegrationPermission.DISCONNECT,
  ({ tenantId, user }) => controller().disconnectQuickBooks(tenantId, user.id),
)
