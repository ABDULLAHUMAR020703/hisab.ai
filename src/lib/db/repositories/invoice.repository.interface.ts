import type { InvoiceRecord } from '../entities'

export type InvoiceSortField =
  | 'createdAt'
  | 'date'
  | 'dueDate'
  | 'invoiceNo'
  | 'total'
  | 'customerName'

export interface InvoiceListOptions {
  search?: string
  status?: string
  zatcaStatus?: string
  invoiceType?: string
  customerId?: string
  datePreset?: 'today' | 'week' | 'month' | 'custom'
  dateFrom?: string
  dateTo?: string
  overdue?: boolean
  sortBy?: InvoiceSortField
  sortDir?: 'asc' | 'desc'
  page?: number
  limit?: number
}

export interface InvoiceListResult {
  items: InvoiceRecord[]
  total: number
  page: number
  limit: number
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

export interface InvoiceAdjustmentCreateInput {
  sourceInvoiceId: string
  adjustmentType: 'CREDIT_NOTE' | 'DEBIT_NOTE'
  date: string | Date
  dueDate: string | Date
  lines: InvoiceLineInput[]
  notes?: string | null
  createdById: string
}

export interface InvoiceRepository {
  findMany(options?: InvoiceListOptions): Promise<InvoiceListResult>
  findById(id: string): Promise<InvoiceRecord | null>
  create(input: InvoiceCreateInput): Promise<InvoiceRecord>
  createAdjustment(input: InvoiceAdjustmentCreateInput): Promise<InvoiceRecord>
  update(id: string, input: InvoiceUpdateInput): Promise<InvoiceRecord>
  delete(id: string): Promise<void>
}
