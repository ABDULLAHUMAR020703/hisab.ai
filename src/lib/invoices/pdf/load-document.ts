import 'server-only'
import type { CustomerRecord, InvoiceLineRecord, InvoiceRecord } from '@/lib/db/entities'
import type { CompanySettingsRecord } from '@/lib/db/types'
import { getInvoiceRepository, getSettingsRepository } from '@/lib/db/provider'
import { computeDisplayBusinessStatus } from '@/lib/ui/invoice-status'
import { resolveInvoiceQrForPdf } from '../qr-for-pdf'
import { buildAddressLines, invoicePdfTitle } from './format'
import { loadCompanyLogoImage } from '@/lib/branding/load-logo-image'
import type {
  InvoicePdfDocument,
  PdfCustomerInfo,
  PdfLineItem,
  PdfTaxSummaryRow,
  PdfZatcaInfo,
} from './types'

function buildCustomerInfo(customer: CustomerRecord | Partial<CustomerRecord> | undefined): PdfCustomerInfo {
  const c = customer ?? { name: 'Customer' }
  const addressLines = buildAddressLines({
    buildingNumber: c.buildingNumber,
    streetAddress: c.streetAddress,
    address: c.address,
    district: c.district,
    city: c.city,
    postalCode: c.postalCode,
    country: c.country,
  })

  return {
    name: c.name ?? 'Customer',
    address: addressLines.length > 0 ? addressLines.join(', ') : null,
    city: c.city ?? null,
    country: c.country ?? null,
    taxId: c.taxId ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
  }
}

function buildLineItems(lines: InvoiceLineRecord[]): PdfLineItem[] {
  return lines.map((line, index) => {
    const taxable = line.amount
    const taxAmount = taxable * (line.taxRate / 100)
    return {
      index: index + 1,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      taxAmount,
      lineTotal: taxable + taxAmount,
    }
  })
}

function buildTaxSummary(lines: InvoiceLineRecord[]): PdfTaxSummaryRow[] {
  const map = new Map<number, { taxableAmount: number; taxAmount: number }>()
  for (const line of lines) {
    const taxable = line.amount
    const taxAmount = taxable * (line.taxRate / 100)
    const existing = map.get(line.taxRate) ?? { taxableAmount: 0, taxAmount: 0 }
    map.set(line.taxRate, {
      taxableAmount: existing.taxableAmount + taxable,
      taxAmount: existing.taxAmount + taxAmount,
    })
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taxRate, amounts]) => ({
      taxRate,
      taxableAmount: amounts.taxableAmount,
      taxAmount: amounts.taxAmount,
    }))
}

function buildZatcaInfo(
  invoice: InvoiceRecord,
  settings: CompanySettingsRecord,
): PdfZatcaInfo | null {
  const status = (invoice.zatcaStatus ?? 'DRAFT').toUpperCase()
  if (status === 'DRAFT' || status === 'NOT_SUBMITTED') {
    return null
  }

  const route: PdfZatcaInfo['route'] =
    status === 'CLEARED' ? 'Clearance' : 'Reporting'

  return {
    requestId: invoice.zatcaRequestId ?? invoice.zatcaGlobalTransactionId ?? null,
    submissionDate: invoice.zatcaSubmissionDate ?? null,
    route,
    environment: settings.zatcaEnvironment === 'PRODUCTION' ? 'Production' : 'Simulation',
    status,
  }
}

function mapCompanyBranding(
  settings: CompanySettingsRecord,
  logoPng: Buffer | null,
): InvoicePdfDocument['company'] {
  return {
    companyName: settings.companyName,
    legalName: settings.legalName,
    taxId: settings.taxId,
    commercialRegistration: settings.commercialRegistration,
    addressLines: buildAddressLines({
      buildingNumber: settings.buildingNumber,
      streetAddress: settings.streetAddress,
      address: settings.address,
      district: settings.district,
      city: settings.city,
      postalCode: settings.postalCode,
      country: settings.country,
    }),
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    currency: settings.currency,
    logoPng,
  }
}

export async function loadInvoicePdfDocument(invoiceId: string): Promise<InvoicePdfDocument | null> {
  const [invoice, settings] = await Promise.all([
    getInvoiceRepository().findById(invoiceId),
    getSettingsRepository().findFirst(),
  ])

  if (!invoice || !settings) return null

  const lines = invoice.lines ?? []
  const { title, accent } = invoicePdfTitle(invoice.invoiceType)
  const zatcaStatus = (invoice.zatcaStatus ?? 'DRAFT').toUpperCase()
  const submitted = zatcaStatus !== 'DRAFT' && zatcaStatus !== 'NOT_SUBMITTED'

  const logoPng = await loadCompanyLogoImage({
    logoUrl: settings.logoUrl,
    logoStoragePath: settings.logoStoragePath,
  })
  const qr = await resolveInvoiceQrForPdf(invoiceId)

  return {
    invoiceType: invoice.invoiceType,
    title,
    titleAccent: accent,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    dueDate: invoice.dueDate,
    terms: invoice.terms,
    currency: invoice.currency || settings.currency || 'SAR',
    businessStatus: computeDisplayBusinessStatus({
      status: invoice.status,
      dueDate: invoice.dueDate,
      balance: invoice.balance,
    }),
    zatcaStatusLabel: submitted ? zatcaStatus.replaceAll('_', ' ') : null,
    referencedInvoiceNo: invoice.referencedInvoiceNo ?? null,
    customer: buildCustomerInfo(invoice.customer),
    lines: buildLineItems(lines),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balance,
    taxSummary: buildTaxSummary(lines),
    notes: invoice.notes,
    zatcaInfo: buildZatcaInfo(invoice, settings),
    qr,
    company: mapCompanyBranding(settings, logoPng),
  }
}
