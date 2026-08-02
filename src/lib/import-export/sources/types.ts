import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'

export interface ImportSourceResource {
  key: string
  label: string
  moduleKey: string
}

export interface NormalizedImportResource extends ImportSourceResource {
  rows: Record<string, string>[]
  totalCount?: number
  countAccuracy?: 'exact' | 'upper-bound'
  sampled?: boolean
}

export interface SourcePreviewBatch { count: number; rows: unknown[] }

export interface ImportSourceFetchOptions {
  companyId?: string
  resumeStartPosition?: number
  partitionStart?: string
  partitionEnd?: string
  signal?: AbortSignal
  onCheckpoint?: (checkpoint: { startPosition: number; partitionStart?: string; partitionEnd?: string; fetched: number }) => Promise<void> | void
  onBatch?: (rows:Record<string,string>[], checkpoint: { startPosition:number; partitionStart?:string; partitionEnd?:string; fetched:number })=>Promise<void>|void
  preview?: {
    sampleSize: number
    cache?: Map<string, Promise<SourcePreviewBatch>>
  }
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
