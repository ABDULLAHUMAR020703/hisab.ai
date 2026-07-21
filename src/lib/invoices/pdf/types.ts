import type { InvoiceQrForPdf } from '../qr-for-pdf'

export interface PdfCompanyBranding {
  companyName: string
  legalName: string | null
  taxId: string | null
  commercialRegistration: string | null
  addressLines: string[]
  phone: string | null
  email: string | null
  website: string | null
  currency: string
  logoPng: Buffer | null
}

export interface PdfCustomerInfo {
  name: string
  address: string | null
  city: string | null
  country: string | null
  taxId: string | null
  email: string | null
  phone: string | null
}

export interface PdfLineItem {
  index: number
  itemName: string | null
  description: string
  projectService: string | null
  className: string | null
  quantity: number
  unitPrice: number
  taxRate: number
  taxAmount: number
  lineTotal: number
}

export interface PdfTaxSummaryRow {
  taxRate: number
  taxableAmount: number
  taxAmount: number
}

export interface PdfZatcaInfo {
  requestId: string | null
  submissionDate: Date | null
  route: 'Clearance' | 'Reporting'
  environment: 'Simulation' | 'Production'
  status: string
}

export interface InvoicePdfDocument {
  invoiceType: string
  title: string
  titleAccent: string
  invoiceNo: string
  date: Date
  dueDate: Date
  expiryDate: Date | null
  terms: string | null
  taxCalculationMethod: string
  currency: string
  businessStatus: string
  zatcaStatusLabel: string | null
  referencedInvoiceNo: string | null
  customer: PdfCustomerInfo
  lines: PdfLineItem[]
  subtotal: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  taxSummary: PdfTaxSummaryRow[]
  notes: string | null
  zatcaInfo: PdfZatcaInfo | null
  qr: InvoiceQrForPdf | null
  company: PdfCompanyBranding
}

export interface InvoicePdfTemplate {
  id: string
  render(document: InvoicePdfDocument): Promise<Buffer>
}
