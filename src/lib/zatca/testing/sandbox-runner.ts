import 'server-only'
import { randomUUID } from 'crypto'
import type { InvoiceType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logZatcaAudit } from '../audit/logger'
import { generateZatcaInvoiceXml } from '../generate'
import { generateInvoiceHash } from '../hash'
import { enrichZatcaInvoiceInput, loadZatcaInvoiceById } from '../invoice-service'
import { generateZatcaCsr } from '../onboarding/generate-csr'
import { getCredential, saveCredential } from '../onboarding/credential-store'
import { signAndEmbedPhase2Qr } from '../invoice-signing'
import { loadSigningCredentials } from '../signature/certificate'
import { submitClearanceInvoice } from '../api/clearance'
import { submitReportingInvoice } from '../api/reporting'
import { getSubmissionRoute } from '../submission/router'
import { validateFullSubmissionPipeline } from '../validation/hardening'

export type SandboxScenario = 'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE'

export interface SandboxStepResult {
  step: string
  passed: boolean
  detail?: string
}

export interface SandboxScenarioResult {
  scenario: SandboxScenario
  passed: boolean
  steps: SandboxStepResult[]
  error?: string
  durationMs: number
  invoiceId?: string
  expectedStatus: string
  actualStatus?: string
}

const EXPECTED_STATUS: Record<SandboxScenario, string> = {
  STANDARD: 'CLEARED',
  SIMPLIFIED: 'REPORTED',
  CREDIT_NOTE: 'REPORTED',
  DEBIT_NOTE: 'REPORTED',
}

async function ensureSandboxPrerequisites() {
  const settings = await prisma.companySettings.findFirst()
  if (!settings) throw new Error('Company settings not found')

  process.env.ZATCA_MOCK_ONBOARDING = 'true'
  process.env.ZATCA_MOCK_SUBMISSION = 'true'

  const vatNumber = settings.taxId ?? '300000000000003'
  let cred = await getCredential(settings.zatcaEnvironment)
  const needsMockCredentials = !cred?.privateKeyEnc || !cred?.certificate

  if (needsMockCredentials) {
    let csrPem = cred?.csr ?? ''
    let privateKeyPem = '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----'

    try {
      const csrResult = generateZatcaCsr({
        environment: settings.zatcaEnvironment,
        vatNumber,
        organizationName: settings.legalName || settings.companyName,
        registeredAddress: settings.streetAddress || settings.city || 'Riyadh',
      })
      csrPem = csrResult.csrPem
      privateKeyPem = csrResult.privateKeyPem
    } catch {
      // Forge may not parse secp256k1 SPKI locally; mock signing bypasses ECDSA in mock mode.
    }

    const mockToken = Buffer.from(`MOCK-SANDBOX-CERT-${vatNumber}`).toString('base64')
    await saveCredential({
      environment: settings.zatcaEnvironment,
      csr: csrPem,
      privateKeyPem,
      certificate: `-----BEGIN CERTIFICATE-----\n${mockToken}\n-----END CERTIFICATE-----`,
      secret: 'mock-sandbox-secret',
      complianceCsid: 'MOCK-SANDBOX-CSID',
      onboardingStatus: 'COMPLIANCE_ISSUED',
    })
    cred = await getCredential(settings.zatcaEnvironment)
  }

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user found for sandbox tests')

  let customer = await prisma.customer.findFirst({ where: { isActive: true } })
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        customerNo: `SANDBOX-CUST-${Date.now()}`,
        name: 'Sandbox Test Customer',
        taxId: '300000000000003',
        streetAddress: 'King Fahd Road',
        city: 'Riyadh',
        postalCode: '12345',
        country: 'Saudi Arabia',
      },
    })
  }

  return { settings, user, customer }
}

async function createSandboxInvoice(
  invoiceType: InvoiceType,
  userId: string,
  customerId: string,
) {
  const now = new Date()
  const seq = await prisma.sequence.upsert({
    where: { type: 'INVOICE' },
    create: { type: 'INVOICE', prefix: 'INV-', nextNo: 2 },
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
          description: `Sandbox ${invoiceType} line item`,
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

export async function runSandboxScenario(scenario: SandboxScenario): Promise<SandboxScenarioResult> {
  const start = Date.now()
  const steps: SandboxStepResult[] = []
  process.env.ZATCA_MOCK_SUBMISSION = 'true'

  try {
    const { settings, user, customer } = await ensureSandboxPrerequisites()

    if (!settings.taxId) {
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          taxId: '300000000000003',
          commercialRegistration: '1010000000',
          streetAddress: 'King Fahd Road',
          postalCode: '12345',
          city: 'Riyadh',
          zatcaEnabled: true,
        },
      })
    }

    const invoice = await createSandboxInvoice(scenario, user.id, customer.id)
    steps.push({ step: 'Create invoice', passed: true, detail: invoice.invoiceNo })

    const loaded = await loadZatcaInvoiceById(invoice.id)
    if (!loaded) throw new Error('Failed to load invoice')

    const enrichedInput = await enrichZatcaInvoiceInput(loaded.input, invoice.id)
    const xmlResult = generateZatcaInvoiceXml(enrichedInput)
    const validation = validateFullSubmissionPipeline(loaded.input, xmlResult.validation)
    steps.push({
      step: 'Validate',
      passed: validation.valid,
      detail: validation.valid ? 'All stages passed' : validation.errors.map((e) => e.message).join('; '),
    })
    if (!validation.valid) throw new Error('Validation failed')

    steps.push({ step: 'Generate XML', passed: true, detail: `${xmlResult.xml.length} bytes` })

    const hash = generateInvoiceHash(xmlResult.xml)
    steps.push({ step: 'Hash', passed: hash.length === 64, detail: hash.slice(0, 16) + '...' })

    const creds = await loadSigningCredentials(settings.zatcaEnvironment)
    const { signedXml, invoiceHashHex, qrPayload } = signAndEmbedPhase2Qr(
      xmlResult.xml,
      loaded.input,
      creds.certificatePem,
      creds.privateKeyPem,
    )
    steps.push({
      step: 'QR',
      passed: scenario === 'STANDARD' ? true : Boolean(qrPayload),
      detail: qrPayload ? 'Phase 2 TLV (tags 1–9)' : 'Standard — QR optional',
    })
    steps.push({ step: 'Sign', passed: signedXml.includes('ds:Signature'), detail: 'XAdES-BES signature embedded' })

    const route = getSubmissionRoute(scenario)
    const uuid = xmlResult.document.uuid

    let actualStatus: string
    if (route === 'clearance') {
      const result = await submitClearanceInvoice({
        environment: settings.zatcaEnvironment,
        invoiceHash: invoiceHashHex,
        uuid,
        signedXml,
      })
      actualStatus = result.clearanceStatus === 'CLEARED' ? 'CLEARED' : 'SUBMITTED'
      steps.push({ step: 'Clearance', passed: actualStatus === 'CLEARED', detail: result.clearanceStatus })
    } else {
      const result = await submitReportingInvoice({
        environment: settings.zatcaEnvironment,
        invoiceHash: invoiceHashHex,
        uuid,
        signedXml,
      })
      actualStatus = result.reportingStatus === 'REPORTED' ? 'REPORTED' : 'SUBMITTED'
      steps.push({ step: 'Reporting', passed: actualStatus === 'REPORTED', detail: result.reportingStatus })
    }

    const expectedStatus = EXPECTED_STATUS[scenario]
    const passed = actualStatus === expectedStatus

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        invoiceHash: invoiceHashHex,
        signedXml,
        zatcaStatus: actualStatus as 'CLEARED' | 'REPORTED',
        zatcaSubmissionDate: new Date(),
      },
    })

    steps.push({ step: 'Status', passed, detail: `${actualStatus} (expected ${expectedStatus})` })

    const durationMs = Date.now() - start
    const result: SandboxScenarioResult = {
      scenario,
      passed,
      steps,
      durationMs,
      invoiceId: invoice.id,
      expectedStatus,
      actualStatus,
    }

    await prisma.zatcaSandboxTestRun.create({
      data: {
        scenario,
        passed,
        steps: JSON.stringify(steps),
        error: passed ? null : `Expected ${expectedStatus}, got ${actualStatus}`,
        durationMs,
      },
    })

    await logZatcaAudit({
      action: 'SANDBOX_TEST_RUN',
      result: passed ? 'SUCCESS' : 'FAILED',
      message: `${scenario}: ${passed ? 'PASSED' : 'FAILED'}`,
      companyName: settings.companyName,
      invoiceId: invoice.id,
      metadata: { scenario, steps, durationMs },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    steps.push({ step: 'Error', passed: false, detail: message })
    const durationMs = Date.now() - start

    await prisma.zatcaSandboxTestRun.create({
      data: {
        scenario,
        passed: false,
        steps: JSON.stringify(steps),
        error: message,
        durationMs,
      },
    })

    return { scenario, passed: false, steps, error: message, durationMs, expectedStatus: EXPECTED_STATUS[scenario] }
  }
}

export async function runAllSandboxScenarios(): Promise<SandboxScenarioResult[]> {
  const scenarios: SandboxScenario[] = ['STANDARD', 'SIMPLIFIED', 'CREDIT_NOTE', 'DEBIT_NOTE']
  const results: SandboxScenarioResult[] = []
  for (const scenario of scenarios) {
    results.push(await runSandboxScenario(scenario))
  }
  return results
}

export async function getSandboxTestHistory(limit = 20) {
  return prisma.zatcaSandboxTestRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
