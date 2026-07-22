import type { CheckResult, OpeningBalanceMode } from '../types'

export interface ReadinessContext {
  company: {
    companyName: string
    legalName: string | null
    taxId: string | null
    commercialRegistration: string | null
    address: string | null
    city: string | null
    country: string | null
    currency: string | null
    phone: string | null
    email: string | null
    fiscalYearStart: string | null
  }
  accountCount: number
  taxConfigCount: number
  paymentTermsCount: number
  hasOpeningBalanceJournal: boolean
  openingBalanceMode: OpeningBalanceMode
  customerCount: number
  vendorCount: number
  invoiceSequenceConfigured: boolean
  invoiceNextPlausible: boolean
  creditNoteSequenceConfigured: boolean
  debitNoteSequenceConfigured: boolean
  zatca: {
    enabled: boolean
    productionReady: boolean
    hasProductionCsid: boolean
    hasComplianceCsid: boolean
    hasCertificate: boolean
    certificateExpired: boolean
    environment: string
  }
  failedInvoiceCount: number
  likelyTestFindingCount: number
  applicableModules: string[]
}

function required(
  id: string,
  moduleKey: string,
  label: string,
  passed: boolean,
  message: string,
  fixHref: string,
  weight: number,
): CheckResult {
  return {
    id,
    moduleKey,
    severityClass: 'required',
    passed,
    blocked: !passed,
    label,
    message,
    fixHref,
    weight,
  }
}

function recommended(
  id: string,
  moduleKey: string,
  label: string,
  passed: boolean,
  message: string,
  fixHref: string | undefined,
  weight: number,
): CheckResult {
  return {
    id,
    moduleKey,
    severityClass: 'recommended',
    passed,
    blocked: false,
    label,
    message,
    fixHref,
    weight,
  }
}

export function evaluateReadinessChecks(ctx: ReadinessContext): CheckResult[] {
  const applicable = new Set(ctx.applicableModules)
  const checks: CheckResult[] = []

  if (applicable.has('core_company')) {
    const profileOk = Boolean(
      ctx.company.companyName?.trim() &&
        ctx.company.legalName?.trim() &&
        ctx.company.city?.trim() &&
        ctx.company.country?.trim() &&
        ctx.company.currency?.trim(),
    )
    checks.push(
      required(
        'company.profile',
        'core_company',
        'Company Profile',
        profileOk,
        profileOk
          ? 'Company profile is complete.'
          : 'Legal name, city, country, and currency are required.',
        '/settings',
        15,
      ),
    )
    const vatOk = Boolean(ctx.company.taxId?.trim())
    checks.push(
      required(
        'company.vat',
        'core_company',
        'VAT Registration',
        vatOk,
        vatOk ? 'VAT / TRN is set.' : 'VAT registration (TRN) is missing.',
        '/settings',
        8,
      ),
    )
    const crOk = Boolean(ctx.company.commercialRegistration?.trim())
    checks.push(
      required(
        'company.cr',
        'core_company',
        'Commercial Registration',
        crOk,
        crOk ? 'CR number is set.' : 'Commercial registration (CR) is missing.',
        '/settings',
        7,
      ),
    )
  }

  if (applicable.has('accounting')) {
    checks.push(
      required(
        'accounting.coa',
        'accounting',
        'Chart of Accounts',
        ctx.accountCount > 0,
        ctx.accountCount > 0
          ? `${ctx.accountCount} accounts configured.`
          : 'Chart of Accounts is not configured.',
        '/accounts',
        10,
      ),
    )
    checks.push(
      required(
        'accounting.fiscal_year',
        'accounting',
        'Fiscal Year',
        Boolean(ctx.company.fiscalYearStart?.trim()),
        ctx.company.fiscalYearStart
          ? `Fiscal year start: ${ctx.company.fiscalYearStart}`
          : 'Fiscal year is not configured.',
        '/settings',
        5,
      ),
    )
    checks.push(
      required(
        'accounting.tax',
        'accounting',
        'Tax Configuration',
        ctx.taxConfigCount > 0,
        ctx.taxConfigCount > 0
          ? `${ctx.taxConfigCount} tax configuration(s).`
          : 'No tax configurations found.',
        '/tax',
        5,
      ),
    )
    checks.push(
      recommended(
        'accounting.payment_terms',
        'accounting',
        'Payment Terms',
        ctx.paymentTermsCount > 0,
        ctx.paymentTermsCount > 0
          ? `${ctx.paymentTermsCount} payment term(s).`
          : 'Payment terms are not configured.',
        '/settings',
        3,
      ),
    )
  }

  if (applicable.has('opening_balances')) {
    const mode = ctx.openingBalanceMode
    let passed = false
    let message = 'Choose existing business opening balances or start with zero.'
    if (mode === 'NEW_BUSINESS_ZERO') {
      passed = true
      message = 'Acknowledged: start new business with zero opening balances.'
    } else if (mode === 'EXISTING_BUSINESS') {
      passed = ctx.hasOpeningBalanceJournal
      message = passed
        ? 'Opening balance journal found.'
        : 'Existing business requires opening balances before go-live.'
    } else if (ctx.hasOpeningBalanceJournal) {
      passed = true
      message = 'Opening balance journal found.'
    }
    checks.push(
      required(
        'accounting.opening_balances',
        'opening_balances',
        'Opening Balances',
        passed,
        message,
        '/migration-wizard',
        10,
      ),
    )
  }

  if (applicable.has('document_numbering')) {
    const ok =
      ctx.invoiceSequenceConfigured &&
      ctx.invoiceNextPlausible &&
      ctx.creditNoteSequenceConfigured &&
      ctx.debitNoteSequenceConfigured
    checks.push(
      required(
        'numbering.sequences',
        'document_numbering',
        'Document Numbering',
        ok,
        ok
          ? 'Invoice, credit note, and debit note sequences are configured.'
          : 'Document numbering is missing or has an invalid next number.',
        '/settings/document-numbering',
        10,
      ),
    )
  }

  if (applicable.has('zatca') && ctx.zatca.enabled) {
    const ok =
      ctx.zatca.productionReady &&
      ctx.zatca.hasProductionCsid &&
      ctx.zatca.hasCertificate &&
      !ctx.zatca.certificateExpired
    checks.push(
      required(
        'zatca.production',
        'zatca',
        'ZATCA Production',
        ok,
        ok
          ? 'ZATCA Production is ready with valid certificates.'
          : ctx.zatca.certificateExpired
            ? 'Production certificate is expired.'
            : 'ZATCA Production onboarding is not complete.',
        '/settings',
        25,
      ),
    )
  }

  if (applicable.has('sales')) {
    checks.push(
      recommended(
        'master.customers',
        'sales',
        'Customers',
        ctx.customerCount > 0,
        ctx.customerCount > 0
          ? `${ctx.customerCount} customer(s).`
          : 'No customers yet (optional before go-live).',
        '/customers',
        4,
      ),
    )
    checks.push(
      recommended(
        'hygiene.failed_invoices',
        'sales',
        'Review Failed Invoices',
        ctx.failedInvoiceCount === 0,
        ctx.failedInvoiceCount === 0
          ? 'No failed invoices.'
          : `${ctx.failedInvoiceCount} failed invoice(s) should be reviewed.`,
        '/invoices',
        5,
      ),
    )
  }

  if (applicable.has('purchasing')) {
    checks.push(
      recommended(
        'master.vendors',
        'purchasing',
        'Vendors',
        ctx.vendorCount > 0,
        ctx.vendorCount > 0
          ? `${ctx.vendorCount} vendor(s).`
          : 'No vendors yet (optional before go-live).',
        '/vendors',
        3,
      ),
    )
  }

  checks.push(
    recommended(
      'hygiene.test_data',
      'sales',
      'Review Likely Test Data',
      ctx.likelyTestFindingCount === 0,
      ctx.likelyTestFindingCount === 0
        ? 'No high-confidence test data detected.'
        : `${ctx.likelyTestFindingCount} likely test record(s) detected.`,
      undefined,
      5,
    ),
  )

  return checks.filter((c) => applicable.has(c.moduleKey) || c.id === 'hygiene.test_data')
}
