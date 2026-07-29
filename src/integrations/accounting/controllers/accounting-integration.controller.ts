import { NextResponse } from 'next/server'
import type { AccountingIntegrationService } from '../services/accounting-integration.service'
import { Provider } from '../contracts/types'
import { AccountingIntegrationException } from '../utils/exceptions'

export class AccountingIntegrationController {
  constructor(private readonly service: AccountingIntegrationService) {}

  async list(tenantId: string): Promise<Response> {
    return Response.json(await this.service.list(tenantId))
  }

  async quickBooksStatus(tenantId: string): Promise<Response> {
    return Response.json(await this.service.getStatus(tenantId, Provider.QUICKBOOKS))
  }

  async connectQuickBooks(tenantId: string, userId: string): Promise<Response> {
    return Response.json(await this.service.connect(tenantId, userId, Provider.QUICKBOOKS))
  }

  async quickBooksCallback(request: Request, tenantId: string, userId: string): Promise<Response> {
    const callback = new URL(request.url)
    const destination = new URL('/settings/integrations', callback.origin)
    try {
      await this.service.completeOAuth(tenantId, userId, Provider.QUICKBOOKS, {
        state: callback.searchParams.get('state') ?? '',
        code: callback.searchParams.get('code'),
        realmId: callback.searchParams.get('realmId'),
        providerError: callback.searchParams.get('error'),
      })
      destination.searchParams.set('quickbooks', 'connected')
      destination.searchParams.delete('message')
    } catch (error) {
      destination.searchParams.set('quickbooks', 'error')
      destination.searchParams.set(
        'message',
        error instanceof AccountingIntegrationException
          ? error.message
          : 'QuickBooks authorization could not be completed.',
      )
    }
    const response = NextResponse.redirect(destination, 303)
    response.headers.set('x-integration-result', destination.searchParams.get('quickbooks') ?? 'unknown')
    return response
  }

  async disconnectQuickBooks(tenantId: string, userId: string): Promise<Response> {
    return Response.json(await this.service.disconnect(tenantId, userId, Provider.QUICKBOOKS))
  }
}
