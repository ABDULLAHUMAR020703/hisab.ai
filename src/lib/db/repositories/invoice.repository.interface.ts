import type { InvoiceRecord } from '../entities'

export interface InvoiceListOptions {
  search?: string
  status?: string
}

export interface InvoiceRepository {
  findMany(options?: InvoiceListOptions): Promise<InvoiceRecord[]>
  findById(id: string): Promise<InvoiceRecord | null>
}
