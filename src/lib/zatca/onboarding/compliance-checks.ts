import 'server-only'
import { randomUUID } from 'crypto'
import type { InvoiceType, ZatcaEnvironment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logZatcaAudit } from '../audit/logger'
import { submitComplianceInvoice } from '../api/compliance-invoices'
import { generateZatcaInvoiceXml } from '../generate'
import { generateInvoiceHash } from '../hash'
import { enrichZatcaInvoiceInput, loadZatcaInvoiceById } from '../invoice-service'
import { signAndEmbedPhase2Qr } from '../invoice-signing'
import { loadComplianceSigningCredentials } from '../signature/certificate'
import { validateFullSubmissionPipeline } from '../validation/hardening'
import type { OnboardingAuditContext } from './types'

export type ComplianceCheckScenario = 'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE'

export interface ComplianceCheckResult {
  scenario: ComplianceCheckScenario
  passed: boolean
  validationStatus: string
  requestId?: string
  error?: string
}

export interface ComplianceChecksSummary {
  passed: boolean
  results: ComplianceCheckResult[]
}

const SCENARIOS: ComplianceCheckScenario[] = ['STANDARD', 'SIMPLIFIED', 'CREDIT_NOTE', 'DEBIT_NOTE']

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
          description: `ZATCA compliance check — ${invoiceType}`,
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
): Promise<ComplianceCheckResult> {
  try {
    const invoice = await createComplianceTestInvoice(scenario, userId, customerId)
    const loaded = await loadZatcaInvoiceById(invoice.id)
    if (!loaded) throw new Error('Failed to load compliance test invoice')

    const enrichedInput = await enrichZatcaInvoiceInput(loaded.input, invoice.id)
    const xmlResult = generateZatcaInvoiceXml(enrichedInput)
    const validation = validateFullSubmissionPipeline(loaded.input, xmlResult.validation)
    if (!validation.valid) {
      throw new Error(validation.errors.map((e) => e.message).join('; '))
    }

    const creds = await loadComplianceSigningCredentials(environment)
    const { signedXml, invoiceHashHex } = signAndEmbedPhase2Qr(
      xmlResult.xml,
      loaded.input,
      creds.certificatePem,
      creds.privateKeyPem,
    )

    generateInvoiceHash(xmlResult.xml)

    const submission = await submitComplianceInvoice({
      environment,
      invoiceHash: invoiceHashHex,
      uuid: xmlResult.document.uuid,
      signedXml,
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
        zatcaResponseMessage: submission.responseMessage,
      },
    })

    return {
      scenario,
      passed,
      validationStatus: submission.validationStatus,
      requestId: submission.requestId,
    }
  } catch (error) {
    return {
      scenario,
      passed: false,
      validationStatus: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Submits sample Standard, Simplified, Credit, and Debit invoices to ZATCA /compliance/invoices.
 */
export async function runComplianceChecks(
  environment: ZatcaEnvironment,
  auditContext?: OnboardingAuditContext,
): Promise<ComplianceChecksSummary> {
  const settings = await prisma.companySettings.findFirst()
  if (!settings) throw new Error('Company settings not found')

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user found for compliance checks')

  // Standard tax invoices require a buyer with a valid 15-digit VAT TRN. Reuse an
  // existing customer only if it already has one; otherwise create/ensure a
  // dedicated compliance customer with a valid buyer TRN so the STANDARD scenario
  // passes (a precondition for issuing the Production CSID).
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
  for (const scenario of SCENARIOS) {
    const result = await runSingleComplianceCheck(scenario, environment, user.id, customer.id)
    results.push(result)

    await logZatcaAudit({
      action: 'COMPLIANCE_CHECK_SCENARIO',
      result: result.passed ? 'SUCCESS' : 'FAILED',
      message: `${scenario}: ${result.validationStatus}`,
      userId: auditContext?.userId,
      userName: auditContext?.userName,
      companyName: settings.companyName,
      metadata: { scenario, ...result },
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
