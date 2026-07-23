import 'server-only'
import type { CustomerRecord, InvoiceLineRecord, InvoiceRecord } from '@/lib/db/entities'
import type { CompanySettingsRecord } from '@/lib/db/types'
import { DEFAULT_CURRENCY, normalizeCurrency } from '@/lib/currency/constants'
import { getInvoiceRepository, getSettingsRepository } from '@/lib/db/provider'
import { computeDisplayBusinessStatus } from '@/lib/ui/invoice-status'
import {
  calculateInvoiceLine,
  calculateInvoiceTotals,
  type InvoiceTaxCalculationMethod,
} from '@/lib/invoices/calculations'
import { roundMoney } from '@/lib/tax/calculator'
import { normalizeTaxCalculationMethod } from '@/lib/invoices/validation'
import { resolveZatcaInvoiceTypeCodeName } from '@/lib/zatca/classification'
import { resolveInvoiceTypeCodeName } from '@/lib/zatca/constants'
import { getSubmissionRoute } from '@/lib/zatca/submission/router'
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

function buildLineItems(
  lines: InvoiceLineRecord[],
  method: InvoiceTaxCalculationMethod,
): PdfLineItem[] {
  return lines.map((line, index) => {
    const calc = calculateInvoiceLine(
      { quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate },
      method,
    )
    return {
      index: index + 1,
      itemName: line.itemName ?? null,
      description: line.description,
      projectService: line.projectService ?? null,
      className: line.className ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: calc.taxRate,
      taxAmount: calc.taxAmount,
      lineTotal: calc.lineTotal,
    }
  })
}

function buildTaxSummary(
  lines: InvoiceLineRecord[],
  method: InvoiceTaxCalculationMethod,
): PdfTaxSummaryRow[] {
  const map = new Map<number, { taxableAmount: number; taxAmount: number }>()
  for (const line of lines) {
    const calc = calculateInvoiceLine(
      { quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate },
      method,
    )
    const existing = map.get(calc.taxRate) ?? { taxableAmount: 0, taxAmount: 0 }
    map.set(calc.taxRate, {
      taxableAmount: roundMoney(existing.taxableAmount + calc.amount),
      taxAmount: roundMoney(existing.taxAmount + calc.taxAmount),
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

  const codeName = resolveZatcaInvoiceTypeCodeName({
    invoiceType: invoice.invoiceType,
    customer: invoice.customer ? { taxId: invoice.customer.taxId } : undefined,
    referencedSourceInvoiceType: invoice.referencedInvoiceType,
  })
  const submissionRoute = getSubmissionRoute(
    invoice.invoiceType,
    settings.zatcaEnvironment,
    resolveInvoiceTypeCodeName({
      invoiceType: invoice.invoiceType,
      invoiceTypeCodeNameOverride: codeName,
    }),
  )
  const route: PdfZatcaInfo['route'] =
    submissionRoute === 'clearance' ? 'Clearance' : 'Reporting'

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

  const method = normalizeTaxCalculationMethod(invoice.taxCalculationMethod)
  const lines = invoice.lines ?? []
  const totals = calculateInvoiceTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
    })),
    method,
  )
  const { title, accent } = invoicePdfTitle(invoice.invoiceType)
  const zatcaStatus = (invoice.zatcaStatus ?? 'DRAFT').toUpperCase()
  const submitted = zatcaStatus !== 'DRAFT' && zatcaStatus !== 'NOT_SUBMITTED'

  const logoPng = await loadCompanyLogoImage({
    logoUrl: settings.logoUrl,
    logoStoragePath: settings.logoStoragePath,
    logoUploadedAt: settings.logoUploadedAt,
  })
  const qr = await resolveInvoiceQrForPdf(invoiceId)

  return {
    invoiceType: invoice.invoiceType,
    title,
    titleAccent: accent,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    dueDate: invoice.dueDate,
    expiryDate: invoice.expiryDate ?? null,
    terms: invoice.terms,
    taxCalculationMethod: method,
    currency: normalizeCurrency(invoice.currency || settings.currency || DEFAULT_CURRENCY),
    businessStatus: computeDisplayBusinessStatus({
      status: invoice.status,
      dueDate: invoice.dueDate,
      balance: invoice.balance,
    }),
    zatcaStatusLabel: submitted ? zatcaStatus.replaceAll('_', ' ') : null,
    referencedInvoiceNo: invoice.referencedInvoiceNo ?? null,
    customer: buildCustomerInfo(invoice.customer),
    lines: buildLineItems(lines, method),
    // Use the same commercial rounding path as ZATCA XML (not a stale header total).
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balance,
    taxSummary: buildTaxSummary(lines, method),
    notes: invoice.notes,
    zatcaInfo: buildZatcaInfo(invoice, settings),
    qr,
    company: mapCompanyBranding(settings, logoPng),
  }
}
