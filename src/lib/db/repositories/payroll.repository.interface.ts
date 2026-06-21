import type { PayrollEntryRecord } from '../entities'

export interface PayrollListOptions {
  search?: string
}

export interface PayrollRepository {
  findMany(options?: PayrollListOptions): Promise<PayrollEntryRecord[]>
  findById(id: string): Promise<PayrollEntryRecord | null>
}
