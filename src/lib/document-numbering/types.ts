/** Supported document types for company-level numbering. Extensible without engine changes. */
export const DOCUMENT_TYPES = [
  'INVOICE',
  'ESTIMATE',
  'PURCHASE_ORDER',
  'BILL',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'VENDOR_CREDIT',
  'SALES_ORDER',
  'SALES_RECEIPT',
  'EXPENSE',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_DEFAULTS: Record<
  DocumentType,
  { prefix: string; padding: number; startingNumber: number; label: string }
> = {
  INVOICE: { prefix: 'INV-', padding: 6, startingNumber: 1, label: 'Invoice' },
  ESTIMATE: { prefix: 'EST-', padding: 6, startingNumber: 1, label: 'Estimate' },
  PURCHASE_ORDER: { prefix: 'PO-', padding: 6, startingNumber: 1, label: 'Purchase Order' },
  BILL: { prefix: 'BILL-', padding: 6, startingNumber: 1, label: 'Bill' },
  CREDIT_NOTE: { prefix: 'CN-', padding: 6, startingNumber: 1, label: 'Credit Note' },
  DEBIT_NOTE: { prefix: 'DN-', padding: 6, startingNumber: 1, label: 'Debit Note' },
  VENDOR_CREDIT: { prefix: 'VC-', padding: 6, startingNumber: 1, label: 'Vendor Credit' },
  SALES_ORDER: { prefix: 'SO-', padding: 6, startingNumber: 1, label: 'Sales Order' },
  SALES_RECEIPT: { prefix: 'SR-', padding: 6, startingNumber: 1, label: 'Sales Receipt' },
  EXPENSE: { prefix: 'EXP-', padding: 6, startingNumber: 1, label: 'Expense' },
}

export interface DocumentSequenceRecord {
  id: string
  companyId: string
  documentType: DocumentType | string
  prefix: string
  startingNumber: number
  nextNumber: number
  padding: number
  suffix: string
  createdAt: string
  updatedAt: string
}

export interface DocumentSequenceUpdateInput {
  prefix?: string
  startingNumber?: number
  nextNumber?: number
  padding?: number
  suffix?: string
}
