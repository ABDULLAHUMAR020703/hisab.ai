import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getOnboardingStatus } from '@/lib/zatca/onboarding/credential-store'
import {
  DETECTION_ENGINE_VERSION,
  FINDING_SAMPLE_LIMIT,
  WIZARD_VERSION,
} from './constants'
import {
  classifyInvoiceRisk,
  finalizeFindingCanAct,
  listActiveRules,
  runRules,
  toFinding,
} from './detection/engine'
import { resolveApplicableModules } from './modules/profile'
import { evaluateReadinessChecks } from './readiness/checks'
import { buildChecklist, computeReadinessScore } from './readiness/scorer'
import type {
  Finding,
  OpeningBalanceMode,
  ProductionLiveState,
  ReadinessAnalysis,
} from './types'
import { isCorruptInvoiceSequence, listDocumentSequences } from '@/lib/document-numbering/service'

async function countRows(
  table: string,
  companyId: string,
  filters?: { eq?: Record<string, string> },
): Promise<number> {
  const db = createAdminClient()
  let q = db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)

  if (
    [
      'customers',
      'vendors',
      'invoices',
      'bills',
      'expenses',
      'inventory_items',
      'cost_centers',
      'chart_of_accounts',
      'tax_rates',
      'payment_terms',
      'journal_entries',
      'payments',
    ].includes(table)
  ) {
    q = q.is('deleted_at', null)
  }
  if (['customers', 'vendors', 'inventory_items', 'cost_centers'].includes(table)) {
    q = q.is('archived_at', null)
  }
  if (filters?.eq) {
    for (const [col, val] of Object.entries(filters.eq)) {
      q = q.eq(col, val)
    }
  }
  const { count } = await q
  return count ?? 0
}

export async function getProductionLiveState(
  companyId?: string,
): Promise<ProductionLiveState> {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data } = await db
    .from('companies')
    .select(
      'production_live_at, production_live_by, production_live_wizard_version, production_live_detection_engine_version',
    )
    .eq('id', cid)
    .maybeSingle()
  return {
    productionLiveAt: data?.production_live_at ? String(data.production_live_at) : null,
    productionLiveBy: data?.production_live_by ? String(data.production_live_by) : null,
    productionLiveWizardVersion: data?.production_live_wizard_version
      ? String(data.production_live_wizard_version)
      : null,
    productionLiveDetectionEngineVersion: data?.production_live_detection_engine_version
      ? String(data.production_live_detection_engine_version)
      : null,
  }
}

export async function runGoLiveAnalyze(companyId?: string): Promise<ReadinessAnalysis> {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()

  const { data: company } = await db
    .from('companies')
    .select(
      'company_name, legal_name, tax_id, commercial_registration, address, city, country, currency, phone, email, fiscal_year_start, opening_balance_mode, readiness_modules',
    )
    .eq('id', cid)
    .single()

  const { data: zatcaSettings } = await db
    .from('company_zatca_settings')
    .select('zatca_enabled, zatca_environment')
    .eq('company_id', cid)
    .maybeSingle()

  const zatcaEnabled = Boolean(zatcaSettings?.zatca_enabled)
  const applicableModules = resolveApplicableModules(
    (company?.readiness_modules as Record<string, unknown>) ?? {},
    zatcaEnabled,
  )

  let onboarding: Awaited<ReturnType<typeof getOnboardingStatus>> | null = null
  try {
    onboarding = await getOnboardingStatus(
      (zatcaSettings?.zatca_environment as 'SANDBOX' | 'PRODUCTION') ?? 'PRODUCTION',
    )
  } catch {
    onboarding = null
  }

  const [
    accountCount,
    taxConfigCount,
    paymentTermsCount,
    customerCount,
    vendorCount,
    failedInvoiceCount,
  ] = await Promise.all([
    countRows('chart_of_accounts', cid),
    countRows('tax_rates', cid),
    countRows('payment_terms', cid),
    countRows('customers', cid),
    countRows('vendors', cid),
    countRows('invoices', cid, { eq: { zatca_status: 'FAILED' } }),
  ])

  const { count: obCount } = await db
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', cid)
    .or('reference.eq.OPENING_BALANCE,description.ilike.%opening balance%')
    .is('deleted_at', null)

  const sequences = await listDocumentSequences(cid)
  const invoiceSeq = sequences.find((s) => s.documentType === 'INVOICE')
  const cnSeq = sequences.find((s) => s.documentType === 'CREDIT_NOTE')
  const dnSeq = sequences.find((s) => s.documentType === 'DEBIT_NOTE')

  const openingBalanceMode = (company?.opening_balance_mode ??
    'UNSET') as OpeningBalanceMode

  // --- Detection findings (sampled) ---
  const findings: Finding[] = []
  const rulesExecuted = listActiveRules().map((r) => r.id)

  const { data: invoices } = await db
    .from('invoices')
    .select(
      'id, invoice_no, status, zatca_status, invoice_uuid, invoice_hash, customer_id, total',
    )
    .eq('company_id', cid)
    .is('deleted_at', null)
    .limit(500)

  const invoiceIds = (invoices ?? []).map((i) => String(i.id))
  const paymentCounts = new Map<string, number>()
  if (invoiceIds.length) {
    const { data: payments } = await db
      .from('payments')
      .select('invoice_id')
      .eq('company_id', cid)
      .in('invoice_id', invoiceIds.slice(0, 200))
      .is('deleted_at', null)
    for (const p of payments ?? []) {
      const id = String(p.invoice_id)
      paymentCounts.set(id, (paymentCounts.get(id) ?? 0) + 1)
    }
  }

  const protectedByCustomer = new Map<string, number>()
  let protectedInvoiceCount = 0
  for (const inv of invoices ?? []) {
    const entity = {
      status: inv.status,
      zatcaStatus: inv.zatca_status,
      invoiceNo: inv.invoice_no,
      invoiceUUID: inv.invoice_uuid,
      invoiceHash: inv.invoice_hash,
    }
    const { risk, protectedReason } = classifyInvoiceRisk(entity)
    if (risk === 'PROTECTED') {
      protectedInvoiceCount += 1
      const cidKey = inv.customer_id ? String(inv.customer_id) : ''
      if (cidKey) protectedByCustomer.set(cidKey, (protectedByCustomer.get(cidKey) ?? 0) + 1)
    }
    const detected = runRules({
      entityType: 'invoice',
      entity,
      related: { paymentCount: paymentCounts.get(String(inv.id)) ?? 0 },
    })
    if (risk === 'PROTECTED' || detected.confidence >= 0.35 || risk === 'REVIEW') {
      findings.push(
        finalizeFindingCanAct(
          toFinding({
            entityType: 'invoice',
            entityId: String(inv.id),
            label: String(inv.invoice_no ?? inv.id),
            risk,
            confidence: risk === 'PROTECTED' ? 1 : detected.confidence,
            factors:
              risk === 'PROTECTED'
                ? [
                    {
                      ruleId: 'invoice.protected',
                      reason: protectedReason ?? 'Protected ZATCA record',
                      weight: 1,
                    },
                  ]
                : detected.factors,
            matchedRuleIds:
              risk === 'PROTECTED' ? ['invoice.protected'] : detected.matchedRuleIds,
            protectedReason,
          }),
          false,
        ),
      )
    }
  }

  const { data: customers } = await db
    .from('customers')
    .select('id, name')
    .eq('company_id', cid)
    .is('deleted_at', null)
    .is('archived_at', null)
    .limit(300)

  const customerInvoiceCounts = new Map<string, number>()
  for (const inv of invoices ?? []) {
    if (!inv.customer_id) continue
    const key = String(inv.customer_id)
    customerInvoiceCounts.set(key, (customerInvoiceCounts.get(key) ?? 0) + 1)
  }

  for (const c of customers ?? []) {
    const detected = runRules({
      entityType: 'customer',
      entity: { name: c.name },
      related: { invoiceCount: customerInvoiceCounts.get(String(c.id)) ?? 0 },
    })
    if (detected.confidence < 0.35) continue
    const hasProtected = (protectedByCustomer.get(String(c.id)) ?? 0) > 0
    findings.push(
      finalizeFindingCanAct(
        toFinding({
          entityType: 'customer',
          entityId: String(c.id),
          label: String(c.name),
          risk: hasProtected ? 'REVIEW' : detected.confidence >= 0.7 ? 'SAFE' : 'REVIEW',
          confidence: detected.confidence,
          factors: detected.factors,
          matchedRuleIds: detected.matchedRuleIds,
          dependencies: [
            {
              entityType: 'invoice',
              count: customerInvoiceCounts.get(String(c.id)) ?? 0,
            },
          ],
        }),
        hasProtected,
      ),
    )
  }

  const { data: vendors } = await db
    .from('vendors')
    .select('id, name')
    .eq('company_id', cid)
    .is('deleted_at', null)
    .is('archived_at', null)
    .limit(200)

  for (const v of vendors ?? []) {
    const detected = runRules({
      entityType: 'vendor',
      entity: { name: v.name },
      related: { invoiceCount: 0 },
    })
    if (detected.confidence < 0.35) continue
    findings.push(
      finalizeFindingCanAct(
        toFinding({
          entityType: 'vendor',
          entityId: String(v.id),
          label: String(v.name),
          risk: detected.confidence >= 0.7 ? 'SAFE' : 'REVIEW',
          confidence: detected.confidence,
          factors: detected.factors,
          matchedRuleIds: detected.matchedRuleIds,
        }),
        false,
      ),
    )
  }

  const sampledFindings = findings.slice(0, FINDING_SAMPLE_LIMIT * 3)
  const likelyTestFindingCount = sampledFindings.filter(
    (f) => f.risk !== 'PROTECTED' && f.confidence >= 70,
  ).length

  const checks = evaluateReadinessChecks({
    company: {
      companyName: String(company?.company_name ?? ''),
      legalName: company?.legal_name ? String(company.legal_name) : null,
      taxId: company?.tax_id ? String(company.tax_id) : null,
      commercialRegistration: company?.commercial_registration
        ? String(company.commercial_registration)
        : null,
      address: company?.address ? String(company.address) : null,
      city: company?.city ? String(company.city) : null,
      country: company?.country ? String(company.country) : null,
      currency: company?.currency ? String(company.currency) : null,
      phone: company?.phone ? String(company.phone) : null,
      email: company?.email ? String(company.email) : null,
      fiscalYearStart: company?.fiscal_year_start
        ? String(company.fiscal_year_start)
        : null,
    },
    accountCount,
    taxConfigCount,
    paymentTermsCount,
    hasOpeningBalanceJournal: (obCount ?? 0) > 0,
    openingBalanceMode,
    customerCount,
    vendorCount,
    invoiceSequenceConfigured: Boolean(invoiceSeq),
    invoiceNextPlausible: invoiceSeq ? !isCorruptInvoiceSequence(invoiceSeq) : false,
    creditNoteSequenceConfigured: Boolean(cnSeq),
    debitNoteSequenceConfigured: Boolean(dnSeq),
    zatca: {
      enabled: zatcaEnabled,
      productionReady:
        onboarding?.onboardingStatus === 'PRODUCTION_READY' ||
        onboarding?.onboardingStatus === 'PRODUCTION_ISSUED',
      hasProductionCsid: Boolean(onboarding?.hasProductionCsid),
      hasComplianceCsid: Boolean(onboarding?.hasComplianceCsid),
      hasCertificate: Boolean(onboarding?.hasCertificate),
      certificateExpired: false,
      environment: String(zatcaSettings?.zatca_environment ?? 'SANDBOX'),
    },
    failedInvoiceCount,
    likelyTestFindingCount,
    applicableModules,
  })

  // Re-run hygiene.test_data with real count — already in checks via likelyTestFindingCount
  const { score, categoryScores, verdict, blocked } = computeReadinessScore(checks)
  const checklist = buildChecklist(checks)

  const [
    productCount,
    costCenterCount,
    billCount,
    expenseCount,
    journalCount,
  ] = await Promise.all([
    countRows('inventory_items', cid),
    countRows('cost_centers', cid),
    countRows('bills', cid),
    countRows('expenses', cid),
    countRows('journal_entries', cid),
  ])

  return {
    score,
    verdict,
    checklist,
    checks,
    blocked,
    categoryScores,
    findings: sampledFindings,
    protectedSummary: {
      invoices: protectedInvoiceCount,
    },
    moduleCounts: {
      customers: customerCount,
      vendors: vendorCount,
      products: productCount,
      costCenters: costCenterCount,
      invoices: invoices?.length ?? 0,
      bills: billCount,
      expenses: expenseCount,
      journals: journalCount,
      failedInvoices: failedInvoiceCount,
    },
    zatca: {
      enabled: zatcaEnabled,
      environment: zatcaSettings?.zatca_environment ?? 'SANDBOX',
      onboardingStatus: onboarding?.onboardingStatus ?? null,
      hasProductionCsid: onboarding?.hasProductionCsid ?? false,
      hasComplianceCsid: onboarding?.hasComplianceCsid ?? false,
      hasCertificate: onboarding?.hasCertificate ?? false,
      hasCsr: onboarding?.hasCsr ?? false,
      zatcaConnected: onboarding?.zatcaConnected ?? false,
      connectionStatus: onboarding?.connectionStatus ?? null,
    },
    numbering: {
      invoice: invoiceSeq ?? null,
      creditNote: cnSeq ?? null,
      debitNote: dnSeq ?? null,
    },
    rulesExecuted,
    openingBalanceMode,
    applicableModules,
    wizardVersion: WIZARD_VERSION,
    detectionEngineVersion: DETECTION_ENGINE_VERSION,
    analyzedAt: new Date().toISOString(),
  }
}
