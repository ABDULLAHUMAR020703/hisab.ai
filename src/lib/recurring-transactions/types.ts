export const RECURRING_TYPES = ['REMINDER', 'SCHEDULED', 'UNSCHEDULED'] as const
export const RECURRING_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const
export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'] as const
export const TRANSACTION_TYPES = [
  'BILL', 'NON_POSTING_CHARGE', 'CHEQUE', 'NON_POSTING_CREDIT', 'CREDIT_CARD_CREDIT',
  'CREDIT_NOTE', 'DEPOSIT', 'ESTIMATE', 'EXPENSE', 'INVOICE', 'JOURNAL_ENTRY',
  'PAYMENT', 'SALES_RECEIPT', 'TRANSFER', 'SUPPLIER_CREDIT', 'PURCHASE_ORDER',
] as const

export type RecurringType = typeof RECURRING_TYPES[number]
export type RecurringStatus = typeof RECURRING_STATUSES[number]
export type Frequency = typeof FREQUENCIES[number]
export type TransactionType = typeof TRANSACTION_TYPES[number]

export interface RecurringTemplateInput {
  templateName: string
  type: RecurringType
  transactionType: TransactionType
  description?: string | null
  status?: RecurringStatus
  customerId?: string | null
  vendorId?: string | null
  currency?: string
  referenceNumber?: string | null
  notes?: string | null
  amount?: number
  transactionPayload?: Record<string, unknown>
  schedule: {
    frequency: Frequency
    intervalCount: number
    customRule?: Record<string, unknown>
    startDate: string
    endDate?: string | null
    nextRunDate?: string | null
    timeZone: string
    maxRetries?: number
  }
}

export const CUSTOMER_TRANSACTION_TYPES = new Set<TransactionType>(['INVOICE', 'ESTIMATE', 'SALES_RECEIPT', 'PAYMENT', 'CREDIT_NOTE', 'NON_POSTING_CHARGE', 'NON_POSTING_CREDIT'])
export const VENDOR_TRANSACTION_TYPES = new Set<TransactionType>(['BILL', 'EXPENSE', 'PURCHASE_ORDER', 'SUPPLIER_CREDIT', 'CHEQUE', 'CREDIT_CARD_CREDIT'])
