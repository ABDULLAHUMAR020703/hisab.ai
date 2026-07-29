import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'

export interface ImportSourceResource {
  key: string
  label: string
  moduleKey: string
}

export interface NormalizedImportResource extends ImportSourceResource {
  rows: Record<string, string>[]
}

export interface ImportSourceAdapter {
  key: string
  label: string
  resources: ImportSourceResource[]
  fetchResource(
    provider: AccountingProvider,
    context: ProviderAccessContext,
    resourceKey: string,
  ): Promise<NormalizedImportResource>
}
