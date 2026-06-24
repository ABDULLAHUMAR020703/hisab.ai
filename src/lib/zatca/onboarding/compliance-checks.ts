import 'server-only'
import { randomUUID } from 'crypto'
import type { InvoiceType, ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
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
  },
  CREDIT_NOTE: {
    dbInvoiceType: 'CREDIT_NOTE',
    invoiceTypeCodeName: '0200000',
    billingReferenceFrom: 'SIMPLIFIED',
  },
  DEBIT_NOTE: {
    dbInvoiceType: 'DEBIT_NOTE',
    invoiceTypeCodeName: '0200000',
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

async function createComplianceTestInvoice(
  invoiceType: InvoiceType,
  userId: string,
  customerId: string,
) {
  const now = new Date()
  const seq = await prisma.sequence.upsert({
    where: { type: 'INVOICE' },
    create: { type: 'INVOICE', prefix: 'ZAT-', nextNo: 2 },
    update: { nextNo: { increment: 1 } },
  })
  const invoiceNo = `${seq.prefix}${String(seq.nextNo - 1).padStart(4, '0')}`

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

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user found for compliance checks')

  const COMPLIANCE_BUYER_VAT = '399999999900003'
  let customer = await prisma.customer.findFirst({
    where: { isActive: true, taxId: { not: null } },
  })
  if (customer && (customer.taxId?.replace(/\D/g, '').length ?? 0) !== 15) {
    customer = null
  }
  if (!customer) {
    customer = await prisma.customer.upsert({
      where: { customerNo: 'ZATCA-COMPLIANCE' },
      update: { taxId: COMPLIANCE_BUYER_VAT, isActive: true },
      create: {
        customerNo: 'ZATCA-COMPLIANCE',
        name: 'ZATCA Compliance Test Customer',
        taxId: COMPLIANCE_BUYER_VAT,
        streetAddress: settings.streetAddress || 'King Fahd Road',
        city: settings.city || 'Riyadh',
        postalCode: settings.postalCode || '12345',
        country: 'Saudi Arabia',
      },
    })
  }

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
      user.id,
      customer.id,
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

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user found for compliance checks')

  const COMPLIANCE_BUYER_VAT = '399999999900003'
  let customer = await prisma.customer.findFirst({
    where: { isActive: true, taxId: { not: null } },
  })
  if (customer && (customer.taxId?.replace(/\D/g, '').length ?? 0) !== 15) {
    customer = null
  }
  if (!customer) {
    customer = await prisma.customer.upsert({
      where: { customerNo: 'ZATCA-COMPLIANCE' },
      update: { taxId: COMPLIANCE_BUYER_VAT, isActive: true },
      create: {
        customerNo: 'ZATCA-COMPLIANCE',
        name: 'ZATCA Compliance Test Customer',
        taxId: COMPLIANCE_BUYER_VAT,
        streetAddress: settings.streetAddress || 'King Fahd Road',
        city: settings.city || 'Riyadh',
        postalCode: settings.postalCode || '12345',
        country: 'Saudi Arabia',
      },
    })
  }

  const standardReference = await prisma.invoice.findFirst({
    where: { invoiceType: 'STANDARD', zatcaResponseCode: 'PASS' },
    orderBy: { zatcaSubmissionDate: 'desc' },
    select: { invoiceNo: true },
  })
  if (!standardReference?.invoiceNo) {
    throw new Error('A passed STANDARD compliance invoice is required before standard credit/debit checks')
  }

  const noteScenarios: ComplianceCheckScenario[] = ['STANDARD_CREDIT_NOTE', 'STANDARD_DEBIT_NOTE']
  const results: ComplianceCheckResult[] = []

  for (const scenario of noteScenarios) {
    const result = await runSingleComplianceCheck(
      scenario,
      environment,
      user.id,
      customer.id,
      standardReference.invoiceNo,
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
