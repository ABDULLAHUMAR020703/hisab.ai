import type { InvoiceRecord } from '../entities'

export interface InvoiceListOptions {
  search?: string
  status?: string
}

export interface InvoiceLineInput {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  accountId?: string | null
  costCenterId?: string | null
}

export interface InvoiceCreateInput {
  customerId: string
  date: string | Date
  dueDate: string | Date
  lines: InvoiceLineInput[]
  notes?: string | null
  terms?: string | null
  isRecurring?: boolean
  recurringDay?: number | null
  createdById: string
}

export interface InvoiceUpdateInput {
  customerId?: string
  date?: string | Date
  dueDate?: string | Date
  lines?: InvoiceLineInput[]
  notes?: string | null
  terms?: string | null
  status?: string
}

export interface InvoiceRepository {
  findMany(options?: InvoiceListOptions): Promise<InvoiceRecord[]>
  findById(id: string): Promise<InvoiceRecord | null>
  create(input: InvoiceCreateInput): Promise<InvoiceRecord>
  update(id: string, input: InvoiceUpdateInput): Promise<InvoiceRecord>
  delete(id: string): Promise<void>
}
