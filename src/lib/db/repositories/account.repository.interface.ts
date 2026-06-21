import type { ChartOfAccountRecord } from '../entities'

export interface AccountListOptions {
  search?: string
  type?: string
}

export interface AccountRepository {
  findMany(options?: AccountListOptions): Promise<ChartOfAccountRecord[]>
  findById(id: string): Promise<ChartOfAccountRecord | null>
}
