/* eslint-disable @typescript-eslint/no-explicit-any */
export type InvoiceType = 'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
export type ZatcaEnvironment = 'SANDBOX' | 'PRODUCTION'
export type ZatcaInvoiceStatus = 'DRAFT' | 'PENDING' | 'SUBMITTED' | 'CLEARED' | 'REPORTED' | 'REJECTED' | 'FAILED'
export type ZatcaOnboardingStatus =
  | 'NOT_STARTED'
  | 'CSR_GENERATED'
  | 'COMPLIANCE_ISSUED'
  | 'COMPLIANCE_VALIDATED'
  | 'PRODUCTION_ISSUED'
  | 'PRODUCTION_READY'
  | 'FAILED'

export interface CompanySettings {
  [key: string]: any
}

export interface Customer {
  [key: string]: any
}

export interface Invoice {
  [key: string]: any
}

export interface InvoiceLine {
  [key: string]: any
}

export interface ZatcaCredential {
  [key: string]: any
}
