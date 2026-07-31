import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'

export interface ImportSourceResource {
  key: string
  label: string
  moduleKey: string
}

export interface NormalizedImportResource extends ImportSourceResource {
  rows: Record<string, string>[]
}

export interface ImportSourceFetchOptions {
  companyId?: string
  resumeStartPosition?: number
  partitionStart?: string
  partitionEnd?: string
  onCheckpoint?: (checkpoint: { startPosition: number; partitionStart?: string; partitionEnd?: string; fetched: number }) => Promise<void> | void
  onBatch?: (rows:Record<string,string>[])=>Promise<void>|void
}

export interface ImportSourceAdapter {
  key: string
  label: string
  resources: ImportSourceResource[]
  fetchResource(
    provider: AccountingProvider,
    context: ProviderAccessContext,
    resourceKey: string,
    options?: ImportSourceFetchOptions,
  ): Promise<NormalizedImportResource>
}
