import type { ZatcaInvoiceInput } from '../types'
import { validateFullSubmissionPipeline } from '../validation/hardening'
import { generateZatcaInvoiceXml } from '../generate'
import { validateXmlCompliance } from '../validation/xml-compliance'

export interface FailureScenarioResult {
  scenario: string
  expectedFailure: boolean
  passed: boolean
  messages: string[]
}

function baseInput(): ZatcaInvoiceInput {
  return {
    id: 'test',
    invoiceNo: 'INV-TEST',
    invoiceUUID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    invoiceType: 'STANDARD',
    date: new Date('2026-06-10T12:00:00'),
    issueTime: '12:00:00',
    currency: 'SAR',
    subtotal: 1000,
    taxAmount: 150,
    total: 1150,
    lines: [{
      id: '1',
      description: 'Test line',
      quantity: 1,
      unitPrice: 1000,
      taxRate: 15,
      amount: 1000,
    }],
    customer: {
      name: 'Test Customer',
      taxId: '300000000000003',
      streetAddress: 'King Fahd Road',
      city: 'Riyadh',
      postalCode: '12345',
      country: 'Saudi Arabia',
    },
    companySettings: {
      companyName: 'Test Co',
      legalName: 'Test Co LLC',
      taxId: '300000000000003',
      commercialRegistration: '1010000000',
      streetAddress: 'King Fahd Road',
      buildingNumber: '1234',
      district: 'Olaya',
      city: 'Riyadh',
      postalCode: '12345',
      country: 'Saudi Arabia',
      currency: 'SAR',
    },
    invoiceCounterValue: 1,
    previousInvoiceHashBase64: undefined,
  }
}

export function runFailureScenarios(): FailureScenarioResult[] {
  const results: FailureScenarioResult[] = []

  const scenarios: Array<{ name: string; mutate: (i: ZatcaInvoiceInput) => void }> = [
    {
      name: 'Missing company VAT',
      mutate: (i) => { i.companySettings.taxId = '' },
    },
    {
      name: 'Missing company address',
      mutate: (i) => {
        i.companySettings.streetAddress = ''
        i.companySettings.city = ''
      },
    },
    {
      name: 'Missing customer VAT (standard)',
      mutate: (i) => { i.customer.taxId = '' },
    },
    {
      name: 'Invalid UUID',
      mutate: (i) => { i.invoiceUUID = 'not-a-uuid' },
    },
    {
      name: 'Zero taxable amount',
      mutate: (i) => {
        i.lines[0].amount = 0
        i.lines[0].unitPrice = 0
        i.subtotal = 0
        i.taxAmount = 0
        i.total = 0
      },
    },
    {
      name: 'Non-SAR currency',
      mutate: (i) => { i.currency = 'USD' },
    },
  ]

  for (const { name, mutate } of scenarios) {
    const input = baseInput()
    mutate(input)
    const xmlResult = generateZatcaInvoiceXml(input)
    const validation = validateFullSubmissionPipeline(input, xmlResult.validation, xmlResult.document)
    const xmlCompliance = validateXmlCompliance({ xml: xmlResult.xml, invoiceType: input.invoiceType })
    const failed = !validation.valid || !xmlCompliance.valid
    const messages = [
      ...validation.errors.map((e) => e.message),
      ...xmlCompliance.errors.map((e) => e.message),
    ]
    results.push({
      scenario: name,
      expectedFailure: true,
      passed: failed,
      messages,
    })
  }

  return results
}
