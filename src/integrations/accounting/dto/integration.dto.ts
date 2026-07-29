import type { ConnectionStatus, Provider } from '../contracts/types'

export interface IntegrationListItemDto {
  provider: Provider
  name: string
  logo: string | null
  isActive: boolean
  connected: boolean
  status: ConnectionStatus
  companyName: string | null
  lastSync: string | null
  realmId: string | null
  companyEmail: string | null
  country: string | null
  baseCurrency: string | null
  timezone: string | null
  legalName: string | null
  connectedAt: string | null
}

export interface ConnectIntegrationDto {
  authorizationUrl: string
}
