import { randomUUID } from 'crypto'
import { roundMoney } from '@/lib/tax/calculator'
import {
  ZATCA_FIRST_PIH_BASE64,
  ZATCA_INVOICE_TYPE_CODE,
  DEFAULT_UNIT_CODE,
  isStandardTaxInvoice,
  resolveInvoiceTypeCodeName,
  resolveZatcaProfileId,
  SAUDI_COUNTRY_CODE,
  SAUDI_VAT_RATE,
} from './constants'
import type {
  ZatcaCompanySettingsInput,
  ZatcaCustomerInput,
  ZatcaInvoiceDocument,
  ZatcaInvoiceInput,
  ZatcaAdditionalDocumentReference,
  ZatcaInvoiceLine,
  ZatcaParty,
  ZatcaPostalAddress,
  ZatcaTaxCategory,
} from './types'

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatIssueTime(date: Date, issueTime?: string | null): string {
  if (issueTime && /^\d{2}:\d{2}:\d{2}$/.test(issueTime)) return issueTime
  return date.toTimeString().split(' ')[0]
}

function toCountryCode(country?: string | null): string {
  if (!country) return SAUDI_COUNTRY_CODE
  const normalized = country.trim().toLowerCase()
  if (['saudi arabia', 'sa', 'ksa', 'kingdom of saudi arabia'].includes(normalized)) {
    return SAUDI_COUNTRY_CODE
  }
  if (country.trim().length === 2) return country.trim().toUpperCase()
  return SAUDI_COUNTRY_CODE
}

function resolveStreet(streetAddress?: string | null, address?: string | null): string {
  return (streetAddress || address || 'Not Provided').trim()
}

function buildPostalAddress(
  source: {
    streetAddress?: string | null
    address?: string | null
    buildingNumber?: string | null
    district?: string | null
    city?: string | null
    postalCode?: string | null
    country?: string | null
  },
  defaults?: Partial<ZatcaPostalAddress>,
): ZatcaPostalAddress {
  return {
    streetName: resolveStreet(source.streetAddress, source.address),
    buildingNumber: source.buildingNumber?.trim() || defaults?.buildingNumber || '0000',
    citySubdivisionName: source.district?.trim() || defaults?.citySubdivisionName || 'District',
    cityName: source.city?.trim() || defaults?.cityName || 'Riyadh',
    postalZone: source.postalCode?.trim() || defaults?.postalZone || '00000',
    countryCode: toCountryCode(source.country),
  }
}

function taxCategoryFromRate(rate: number): ZatcaTaxCategory {
  if (rate > 0) {
    return { id: 'S', percent: rate, taxSchemeId: 'VAT' }
  }
  return { id: 'Z', percent: 0, taxSchemeId: 'VAT' }
}

function buildSupplierParty(settings: ZatcaCompanySettingsInput): ZatcaParty {
  const identifications: ZatcaParty['identifications'] = []

  // BR-KSA-08: seller PartyIdentification allows only one additional ID (CRN, MOM, ...), not VAT.
  if (settings.commercialRegistration?.trim()) {
    identifications.push({ id: settings.commercialRegistration.trim(), schemeId: 'CRN' })
  }

  return {
    registrationName: (settings.legalName || settings.companyName).trim(),
    vatNumber: settings.taxId?.trim() || undefined,
    identifications,
    postalAddress: buildPostalAddress(settings, {
      cityName: 'Riyadh',
      citySubdivisionName: 'District',
      buildingNumber: '0000',
      postalZone: '00000',
    }),
    email: settings.email?.trim() || undefined,
    telephone: settings.phone?.trim() || undefined,
  }
}

function buildCustomerParty(
  customer: ZatcaCustomerInput,
  input: Pick<ZatcaInvoiceInput, 'invoiceType' | 'invoiceTypeCodeNameOverride'>,
): ZatcaParty {
  const isStandard = isStandardTaxInvoice(input)

  return {
    registrationName: customer.name.trim(),
    vatNumber: isStandard && customer.taxId?.trim() ? customer.taxId.trim() : undefined,
    identifications: [],
    postalAddress: buildPostalAddress(customer),
    email: customer.email?.trim() || undefined,
    telephone: customer.phone?.trim() || undefined,
  }
}

function mapInvoiceLines(lines: ZatcaInvoiceInput['lines']): ZatcaInvoiceLine[] {
  return lines.map((line, index) => {
    const lineExtensionAmount = roundMoney(line.amount)
    // Always use commercial half-up from taxable × rate (same as invoice calculator / PDF).
    // Do not trust a separately stored taxAmount that may have used a different rounding path.
    const taxAmount = roundMoney(lineExtensionAmount * (line.taxRate / 100))

    return {
      id: String(index + 1),
      quantity: line.quantity,
      unitCode: DEFAULT_UNIT_CODE,
      lineExtensionAmount,
      taxAmount,
      itemName: line.description.trim(),
      unitPrice: roundMoney(line.unitPrice),
      taxCategory: taxCategoryFromRate(line.taxRate),
    }
  })
}

function aggregateTaxSubtotals(lines: ZatcaInvoiceLine[]) {
  const buckets = new Map<number, { taxableAmount: number; taxAmount: number; category: ZatcaTaxCategory }>()

  for (const line of lines) {
    const key = line.taxCategory.percent
    const existing = buckets.get(key)
    if (existing) {
      existing.taxableAmount = roundMoney(existing.taxableAmount + line.lineExtensionAmount)
      existing.taxAmount = roundMoney(existing.taxAmount + line.taxAmount)
    } else {
      buckets.set(key, {
        taxableAmount: line.lineExtensionAmount,
        taxAmount: line.taxAmount,
        category: line.taxCategory,
      })
    }
  }

  return Array.from(buckets.values())
}

/**
 * Maps hisab.ai invoice entities to a ZATCA-oriented UBL 2.1 document model.
 *
 * Document TaxTotal / TaxSubtotal / LegalMonetaryTotal are always derived from
 * the same rounded line amounts so BT-112 cannot diverge from line VAT sums.
 */
export function mapInvoiceToZatcaDocument(input: ZatcaInvoiceInput): ZatcaInvoiceDocument {
  const invoiceType = input.invoiceType
  const invoiceLines = mapInvoiceLines(input.lines)
  const taxSubtotals = aggregateTaxSubtotals(invoiceLines)

  const subtotal = roundMoney(
    invoiceLines.reduce((sum, l) => sum + l.lineExtensionAmount, 0),
  )
  const taxAmount = roundMoney(invoiceLines.reduce((sum, l) => sum + l.taxAmount, 0))
  // Enforce TaxInclusiveAmount = TaxExclusiveAmount + TaxAmount (same rounded values).
  const total = roundMoney(subtotal + taxAmount)

  // Keep subtotals' TaxAmount identical to document TaxTotal (single rate or sum of buckets).
  const subtotalTaxSum = roundMoney(taxSubtotals.reduce((s, t) => s + t.taxAmount, 0))
  if (taxSubtotals.length === 1 && taxSubtotals[0]) {
    taxSubtotals[0].taxAmount = taxAmount
    taxSubtotals[0].taxableAmount = subtotal
  } else if (Math.abs(subtotalTaxSum - taxAmount) > 0.001 && taxSubtotals.length > 0) {
    // Allocate residual to the largest bucket so TaxTotal === sum(TaxSubtotal).
    const residual = roundMoney(taxAmount - subtotalTaxSum)
    let largest = taxSubtotals[0]
    for (const bucket of taxSubtotals) {
      if (bucket.taxAmount > largest.taxAmount) largest = bucket
    }
    largest.taxAmount = roundMoney(largest.taxAmount + residual)
  }

  const uuid = input.invoiceUUID?.trim() || randomUUID()
  const currency = input.currency?.trim() || 'SAR'

  const additionalDocumentReferences: ZatcaAdditionalDocumentReference[] = [
    {
      id: 'ICV',
      uuid: String(input.invoiceCounterValue ?? 1),
    },
    {
      id: 'PIH',
      embeddedContent: input.previousInvoiceHashBase64 ?? ZATCA_FIRST_PIH_BASE64,
    },
  ]

  if (input.qrPayloadBase64?.trim()) {
    additionalDocumentReferences.push({
      id: 'QR',
      embeddedContent: input.qrPayloadBase64.trim(),
    })
  }

  return {
    ublVersionId: '2.1',
    profileId: resolveZatcaProfileId(
      invoiceType,
      input.zatcaEnvironment ?? 'SANDBOX',
      input.profileIdOverride,
    ),
    invoiceNumber: input.invoiceNo.trim(),
    uuid,
    issueDate: formatDate(input.date),
    issueTime: formatIssueTime(input.date, input.issueTime),
    invoiceTypeCode: ZATCA_INVOICE_TYPE_CODE[invoiceType],
    invoiceTypeCodeName: resolveInvoiceTypeCodeName(input),
    documentCurrencyCode: currency,
    taxCurrencyCode: currency,
    additionalDocumentReferences,
    supplier: buildSupplierParty(input.companySettings),
    customer: buildCustomerParty(input.customer, input),
    taxTotal: {
      taxAmount,
      subtotals: taxSubtotals.length
        ? taxSubtotals
        : [{
            taxableAmount: subtotal,
            taxAmount,
            category: taxCategoryFromRate(SAUDI_VAT_RATE),
          }],
    },
    legalMonetaryTotal: {
      lineExtensionAmount: subtotal,
      taxExclusiveAmount: subtotal,
      taxInclusiveAmount: total,
      payableAmount: total,
    },
    invoiceLines,
    notes: input.notes?.trim() || undefined,
    billingReferenceId: input.billingReferenceId?.trim() || undefined,
  }
}
