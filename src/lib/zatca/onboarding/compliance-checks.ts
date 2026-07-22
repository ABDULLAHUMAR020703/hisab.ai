import 'server-only'
import { randomUUID } from 'crypto'
import type { InvoiceType, ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSequenceRepository, getSettingsRepository } from '@/lib/db/provider'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { listCompanyUsers } from '@/lib/db/user.repository'
import { prisma } from '@/lib/prisma'
import { logZatcaAudit } from '../audit/logger'
import { submitComplianceInvoice } from '../api/compliance-invoices'
import { generateZatcaInvoiceXml } from '../generate'
import { generateInvoiceHash } from '../hash'
import { enrichZatcaInvoiceInput, loadZatcaInvoiceById } from '../invoice-service'
import { signAndEmbedPhase2Qr } from '../invoice-signing'
import { loadComplianceSigningCredentials } from '../signature/certificate'
import { validateFullSubmissionPipeline } from '../validation/hardening'
import type { ZatcaDocumentProfile } from '../types'
import type { OnboardingAuditContext } from './types'

export type ComplianceCheckScenario =
  | 'STANDARD'
  | 'SIMPLIFIED'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'STANDARD_CREDIT_NOTE'
  | 'STANDARD_DEBIT_NOTE'

export interface ComplianceCheckResult {
  scenario: ComplianceCheckScenario
  passed: boolean
  validationStatus: string
  requestId?: string
  globalTransactionId?: string
  invoiceNo?: string
  error?: string
}

export interface ComplianceChecksSummary {
  passed: boolean
  results: ComplianceCheckResult[]
}

interface ComplianceScenarioConfig {
  dbInvoiceType: InvoiceType
  invoiceTypeCodeName: string
  profileIdOverride?: ZatcaDocumentProfile
  billingReferenceFrom?: 'STANDARD' | 'SIMPLIFIED'
}

const SCENARIO_CONFIG: Record<ComplianceCheckScenario, ComplianceScenarioConfig> = {
  STANDARD: {
    dbInvoiceType: 'STANDARD',
    invoiceTypeCodeName: '0100000',
    profileIdOverride: 'reporting:1.0',
  },
  SIMPLIFIED: {
    dbInvoiceType: 'SIMPLIFIED',
    invoiceTypeCodeName: '0200000',
    profileIdOverride: 'reporting:1.0',
  },
  CREDIT_NOTE: {
    dbInvoiceType: 'CREDIT_NOTE',
    invoiceTypeCodeName: '0200000',
    profileIdOverride: 'reporting:1.0',
    billingReferenceFrom: 'SIMPLIFIED',
  },
  DEBIT_NOTE: {
    dbInvoiceType: 'DEBIT_NOTE',
    invoiceTypeCodeName: '0200000',
    profileIdOverride: 'reporting:1.0',
    billingReferenceFrom: 'SIMPLIFIED',
  },
  STANDARD_CREDIT_NOTE: {
    dbInvoiceType: 'CREDIT_NOTE',
    invoiceTypeCodeName: '0100000',
    profileIdOverride: 'reporting:1.0',
    billingReferenceFrom: 'STANDARD',
  },
  STANDARD_DEBIT_NOTE: {
    dbInvoiceType: 'DEBIT_NOTE',
    invoiceTypeCodeName: '0100000',
    profileIdOverride: 'reporting:1.0',
    billingReferenceFrom: 'STANDARD',
  },
}

const SCENARIOS: ComplianceCheckScenario[] = [
  'STANDARD',
  'SIMPLIFIED',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'STANDARD_CREDIT_NOTE',
  'STANDARD_DEBIT_NOTE',
]

const COMPLIANCE_BUYER_VAT = '399999999900003'
const COMPLIANCE_CUSTOMER_NO = 'ZATCA-COMPLIANCE'

async function resolveComplianceTestUserId(auditContext?: OnboardingAuditContext): Promise<string> {
  if (auditContext?.userId) return auditContext.userId

  const companyId = await resolveCompanyId()
  const members = await listCompanyUsers(companyId)
  if (members.length === 0) {
    throw new Error('No active company user found for compliance checks')
  }

  const preferred = members.find((m) => m.role === 'OWNER' || m.role === 'ADMIN') ?? members[0]
  return preferred.userId
}

async function ensureComplianceTestCustomer(settings: {
  streetAddress?: string | null
  city?: string | null
  postalCode?: string | null
}): Promise<string> {
  const companyId = await resolveCompanyId()
  const db = supabaseDb()

  const { data: dedicated, error: dedicatedError } = await db
    .from('customers')
    .select('id, tax_id')
    .eq('company_id', companyId)
    .eq('customer_no', COMPLIANCE_CUSTOMER_NO)
    .is('deleted_at', null)
    .maybeSingle()

  if (dedicatedError) throw dedicatedError

  if (dedicated) {
    const normalizedVat = dedicated.tax_id?.replace(/\D/g, '') ?? ''
    if (normalizedVat.length !== 15) {
      const { error: updateError } = await db
        .from('customers')
        .update({ tax_id: COMPLIANCE_BUYER_VAT, is_active: true })
        .eq('id', dedicated.id)
      if (updateError) throw updateError
    }
    return dedicated.id as string
  }

  const { data: withVat, error: withVatError } = await db
    .from('customers')
    .select('id, tax_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .not('tax_id', 'is', null)
    .limit(20)

  if (withVatError) throw withVatError

  const existingWithValidVat = (withVat ?? []).find(
    (row) => String(row.tax_id ?? '').replace(/\D/g, '').length === 15,
  )
  if (existingWithValidVat) return existingWithValidVat.id as string

  const { data: created, error: createError } = await db
    .from('customers')
    .insert({
      company_id: companyId,
      customer_no: COMPLIANCE_CUSTOMER_NO,
      name: 'ZATCA Compliance Test Customer',
      tax_id: COMPLIANCE_BUYER_VAT,
      street_address: settings.streetAddress || 'King Fahd Road',
      city: settings.city || 'Riyadh',
      postal_code: settings.postalCode || '12345',
      country: 'Saudi Arabia',
      is_active: true,
    })
    .select('id')
    .single()

  if (createError) throw createError
  return created.id as string
}

async function createComplianceTestInvoice(
  invoiceType: InvoiceType,
  userId: string,
  customerId: string,
) {
  const now = new Date()
  const invoiceNo = await getSequenceRepository().next('ZATCA_COMPLIANCE', 'ZAT-')

  return prisma.invoice.create({
    data: {
      invoiceNo,
      invoiceUUID: randomUUID(),
      invoiceType,
      customerId,
      date: now,
      issueTime: now.toTimeString().split(' ')[0],
      dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      currency: 'SAR',
      subtotal: 1000,
      taxAmount: 150,
      total: 1150,
      balance: 1150,
      createdById: userId,
      lines: {
        create: [{
          description: `ZATCA compliance check - ${invoiceType}`,
          quantity: 1,
          unitPrice: 1000,
          taxRate: 15,
          amount: 1000,
        }],
      },
    },
    include: { customer: true, lines: true },
  })
}

async function runSingleComplianceCheck(
  scenario: ComplianceCheckScenario,
  environment: ZatcaEnvironment,
  userId: string,
  customerId: string,
  billingReferenceId?: string,
): Promise<ComplianceCheckResult> {
  const config = SCENARIO_CONFIG[scenario]
  let invoiceNo: string | undefined
  try {
    const invoice = await createComplianceTestInvoice(
      config.dbInvoiceType,
      userId,
      customerId,
    )
    invoiceNo = invoice.invoiceNo
    const loaded = await loadZatcaInvoiceById(invoice.id)
    if (!loaded) throw new Error('Failed to load compliance test invoice')

    const enrichedInput = await enrichZatcaInvoiceInput({
      ...loaded.input,
      // Compliance scenarios must use the configured document family — not customer-VAT reclassification.
      invoiceType: config.dbInvoiceType,
      zatcaEnvironment: environment,
      billingReferenceId,
      profileIdOverride: config.profileIdOverride,
      invoiceTypeCodeNameOverride: config.invoiceTypeCodeName,
    }, invoice.id)
    const xmlResult = generateZatcaInvoiceXml(enrichedInput)
    const validation = validateFullSubmissionPipeline(enrichedInput, xmlResult.validation)
    if (!validation.valid) {
      throw new Error(validation.errors.map((e) => e.message).join('; '))
    }

    const creds = await loadComplianceSigningCredentials(environment)
    const { signedXml, invoiceHashHex } = signAndEmbedPhase2Qr(
      xmlResult.xml,
      enrichedInput,
      creds.certificatePem,
      creds.privateKeyPem,
    )

    generateInvoiceHash(xmlResult.xml)

    const submission = await submitComplianceInvoice({
      environment,
      invoiceHash: invoiceHashHex,
      uuid: xmlResult.document.uuid,
      signedXml,
      invoiceId: invoice.id,
    })

    const passed = submission.validationStatus === 'PASS' || submission.validationStatus === 'WARNING'

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        invoiceHash: invoiceHashHex,
        signedXml,
        zatcaStatus: passed ? 'SUBMITTED' : 'REJECTED',
        zatcaSubmissionDate: new Date(),
        zatcaRequestId: submission.requestId,
        zatcaGlobalTransactionId: submission.globalTransactionId || null,
        zatcaResponseCode: submission.responseCode,
        zatcaResponseMessage: submission.responseMessage,
        zatcaResponsePayload: JSON.stringify(submission.rawResponse),
        zatcaWarningCount: submission.warningCount,
        zatcaErrorCount: submission.errorCount,
      },
    })

    return {
      scenario,
      passed,
      validationStatus: submission.validationStatus,
      requestId: submission.requestId,
      globalTransactionId: submission.globalTransactionId,
      invoiceNo: invoice.invoiceNo,
    }
  } catch (error) {
    return {
      scenario,
      passed: false,
      validationStatus: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
      invoiceNo,
    }
  }
}

/**
 * Submits sample invoices to ZATCA /compliance/invoices for all required compliance steps.
 */
export async function runComplianceChecks(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
): Promise<ComplianceChecksSummary> {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new Error('Company settings not found')

  const userId = await resolveComplianceTestUserId(auditContext)
  const customerId = await ensureComplianceTestCustomer(settings)

  await logZatcaAudit({
    action: 'COMPLIANCE_CHECKS_STARTED',
    result: 'SUCCESS',
    message: 'Running ZATCA compliance invoice validation suite',
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment, scenarios: SCENARIOS },
  })

  const results: ComplianceCheckResult[] = []
  let standardReferenceInvoiceNo: string | undefined
  let simplifiedReferenceInvoiceNo: string | undefined

  for (const scenario of SCENARIOS) {
    const config = SCENARIO_CONFIG[scenario]
    let billingReferenceId: string | undefined
    if (config.billingReferenceFrom === 'STANDARD') {
      billingReferenceId = standardReferenceInvoiceNo
    } else if (config.billingReferenceFrom === 'SIMPLIFIED') {
      billingReferenceId = simplifiedReferenceInvoiceNo
    }

    if (config.billingReferenceFrom && !billingReferenceId) {
      throw new Error(
        `${config.billingReferenceFrom} compliance invoice must be created before ${scenario}`,
      )
    }

    const result = await runSingleComplianceCheck(
      scenario,
      environment,
      userId,
      customerId,
      billingReferenceId,
    )
    results.push(result)

    if (scenario === 'STANDARD' && result.invoiceNo) {
      standardReferenceInvoiceNo = result.invoiceNo
    }
    if (scenario === 'SIMPLIFIED' && result.invoiceNo) {
      simplifiedReferenceInvoiceNo = result.invoiceNo
    }

    await logZatcaAudit({
      action: 'COMPLIANCE_CHECK_SCENARIO',
      result: result.passed ? 'SUCCESS' : 'FAILED',
      message: `${scenario}: ${result.validationStatus}`,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { ...result },
    })
  }

  const passed = results.every((r) => r.passed)

  await logZatcaAudit({
    action: 'COMPLIANCE_CHECKS_COMPLETED',
    result: passed ? 'SUCCESS' : 'FAILED',
    message: passed ? 'All compliance invoice checks passed' : 'One or more compliance checks failed',
    userId: auditContext?.userId,
    userName: auditContext?.userName,
    companyName: settings.companyName,
    metadata: { environment, passed, results },
  })

  return { passed, results }
}

/** Runs only the standard credit/debit note compliance scenarios (for incremental ZATCA steps). */
export async function runStandardNoteComplianceChecks(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
): Promise<ComplianceChecksSummary> {
  const settings = await getSettingsRepository().findFirst()
  if (!settings) throw new Error('Company settings not found')

  const userId = await resolveComplianceTestUserId(auditContext)
  const customerId = await ensureComplianceTestCustomer(settings)

  const companyId = await resolveCompanyId()
  const { data: standardReference, error: referenceError } = await supabaseDb()
    .from('invoices')
    .select('invoice_no')
    .eq('company_id', companyId)
    .eq('invoice_type', 'STANDARD')
    .eq('zatca_response_code', 'PASS')
    .is('deleted_at', null)
    .order('zatca_submission_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (referenceError) throw referenceError
  if (!standardReference?.invoice_no) {
    throw new Error('A passed STANDARD compliance invoice is required before standard credit/debit checks')
  }

  const noteScenarios: ComplianceCheckScenario[] = ['STANDARD_CREDIT_NOTE', 'STANDARD_DEBIT_NOTE']
  const results: ComplianceCheckResult[] = []

  for (const scenario of noteScenarios) {
    const result = await runSingleComplianceCheck(
      scenario,
      environment,
      userId,
      customerId,
      standardReference.invoice_no as string,
    )
    results.push(result)

    await logZatcaAudit({
      action: 'COMPLIANCE_CHECK_SCENARIO',
      result: result.passed ? 'SUCCESS' : 'FAILED',
      message: `${scenario}: ${result.validationStatus}`,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { ...result },
    })
  }

  const passed = results.every((r) => r.passed)
  return { passed, results }
}
