import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateReadinessChecks } from '../../src/lib/go-live/readiness/checks'
import { computeReadinessScore } from '../../src/lib/go-live/readiness/scorer'
import { classifyInvoiceRisk, runRules } from '../../src/lib/go-live/detection/engine'
import { buildPreviewPlan } from '../../src/lib/go-live/preview/plan'
import type { ReadinessAnalysis } from '../../src/lib/go-live/types'

describe('readiness scorer', () => {
  it('blocks when required VAT is missing even with high other scores', () => {
    const checks = evaluateReadinessChecks({
      company: {
        companyName: 'Acme',
        legalName: 'Acme LLC',
        taxId: null,
        commercialRegistration: '123',
        address: 'x',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        currency: 'SAR',
        phone: '1',
        email: 'a@b.c',
        fiscalYearStart: '01-01',
      },
      accountCount: 10,
      taxConfigCount: 1,
      paymentTermsCount: 1,
      hasOpeningBalanceJournal: true,
      openingBalanceMode: 'EXISTING_BUSINESS',
      customerCount: 5,
      vendorCount: 2,
      invoiceSequenceConfigured: true,
      invoiceNextPlausible: true,
      creditNoteSequenceConfigured: true,
      debitNoteSequenceConfigured: true,
      zatca: {
        enabled: false,
        productionReady: false,
        hasProductionCsid: false,
        hasComplianceCsid: false,
        hasCertificate: false,
        certificateExpired: false,
        environment: 'SANDBOX',
      },
      failedInvoiceCount: 0,
      likelyTestFindingCount: 0,
      applicableModules: [
        'core_company',
        'accounting',
        'opening_balances',
        'document_numbering',
        'sales',
        'purchasing',
      ],
    })

    const { score, verdict, blocked } = computeReadinessScore(checks)
    assert.equal(blocked.some((b) => b.id === 'company.vat'), true)
    assert.equal(verdict, 'Blocked')
    assert.ok(score > 50)
  })

  it('passes opening balances when NEW_BUSINESS_ZERO is acknowledged', () => {
    const checks = evaluateReadinessChecks({
      company: {
        companyName: 'NewCo',
        legalName: 'NewCo',
        taxId: '300000000000003',
        commercialRegistration: '1',
        address: 'x',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        currency: 'SAR',
        phone: null,
        email: null,
        fiscalYearStart: '01-01',
      },
      accountCount: 5,
      taxConfigCount: 1,
      paymentTermsCount: 0,
      hasOpeningBalanceJournal: false,
      openingBalanceMode: 'NEW_BUSINESS_ZERO',
      customerCount: 0,
      vendorCount: 0,
      invoiceSequenceConfigured: true,
      invoiceNextPlausible: true,
      creditNoteSequenceConfigured: true,
      debitNoteSequenceConfigured: true,
      zatca: {
        enabled: false,
        productionReady: false,
        hasProductionCsid: false,
        hasComplianceCsid: false,
        hasCertificate: false,
        certificateExpired: false,
        environment: 'SANDBOX',
      },
      failedInvoiceCount: 0,
      likelyTestFindingCount: 0,
      applicableModules: [
        'core_company',
        'accounting',
        'opening_balances',
        'document_numbering',
      ],
    })
    assert.equal(
      checks.find((c) => c.id === 'accounting.opening_balances')?.passed,
      true,
    )
  })
})

describe('detection engine', () => {
  it('marks submitted invoices as protected', () => {
    const { risk } = classifyInvoiceRisk({
      zatcaStatus: 'CLEARED',
      invoiceUUID: 'uuid',
      invoiceHash: 'hash',
    })
    assert.equal(risk, 'PROTECTED')
  })

  it('scores test customer names', () => {
    const result = runRules({
      entityType: 'customer',
      entity: { name: 'ZATCA Compliance Test Customer' },
      related: { invoiceCount: 0 },
    })
    assert.ok(result.confidence >= 0.5)
    assert.ok(result.factors.some((f) => f.reason.toLowerCase().includes('demo')))
  })
})

describe('preview plan', () => {
  it('never includes protected invoices in soft-delete', () => {
    const analysis = {
      blocked: [],
      findings: [
        {
          id: 'invoice:1',
          entityType: 'invoice',
          entityId: '1',
          label: 'INV-1',
          risk: 'PROTECTED',
          severityClass: 'recommended',
          confidence: 100,
          confidenceFactors: [],
          matchedRuleIds: [],
          recommendation: 'Protected',
          canAct: false,
          suggestedAction: 'none',
        },
        {
          id: 'invoice:2',
          entityType: 'invoice',
          entityId: '2',
          label: 'INV-2',
          risk: 'SAFE',
          severityClass: 'recommended',
          confidence: 90,
          confidenceFactors: [],
          matchedRuleIds: [],
          recommendation: 'Safe',
          canAct: true,
          suggestedAction: 'soft_delete',
        },
      ],
      protectedSummary: { invoices: 1 },
    } as unknown as ReadinessAnalysis

    const preview = buildPreviewPlan(analysis, {
      softDeleteInvoiceIds: ['1', '2'],
      archiveCustomerIds: [],
      archiveVendorIds: [],
      archiveProductIds: [],
      archiveCostCenterIds: [],
      numbering: null,
      acknowledgeDashboardLive: true,
    })

    const deleted = preview.softDelete.find((g) => g.entityType === 'invoice')?.ids ?? []
    assert.deepEqual(deleted, ['2'])
    assert.ok(preview.blockers.length > 0)
    assert.equal(preview.canExecute, false)
  })
})
