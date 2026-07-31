import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import { applyDuplicateStrategy } from '../../src/lib/import-export/duplicate/duplicate-detector'
import {
  buildQuickBooksValidationReport,
  compareQuickBooksModule,
  validationReportToCsv,
  VALIDATION_CONFIGS,
} from '../../src/lib/quickbooks-validation/engine'
import { buildMigrationReport, migrationReportToCsv } from '../../src/lib/import-export/migration-report'

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    _quickbooksId: '77', name: 'Books by Bessie', email: 'books@example.test',
    phone: '(650) 555-7745', address: '1 Main St', city: 'San Jose', country: 'US',
    taxId: 'T-1', paymentTerms: 30, isActive: true, ...overrides,
  }
}

describe('QuickBooks validation comparison', () => {
  it('passes only when counts and every mapped field match', () => {
    const moduleResult = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.vendors,
      sourceRows: [vendor()], importedRows: [vendor({ _quickbooksId: undefined })], realmId: 'realm-1',
    })
    const report = buildQuickBooksValidationReport('realm-1', [moduleResult], new Date('2026-07-30T00:00:00Z'))
    assert.equal(moduleResult.sourceCount, 1)
    assert.equal(moduleResult.importedCount, 1)
    assert.equal(moduleResult.matchedCount, 1)
    assert.equal(report.passed, true)
  })

  it('fails with field evidence for nulls, mappings, parent relationships, missing and extra records', () => {
    const vendors = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.vendors,
      sourceRows: [vendor()], importedRows: [vendor({ phone: null, paymentTerms: 60, _quickbooksId: undefined })], realmId: 'realm-1',
    })
    assert.equal(vendors.passed, false)
    assert.equal(vendors.issues.find((issue) => issue.field === 'phone')?.kind, 'null_mismatch')
    assert.equal(vendors.issues.find((issue) => issue.field === 'paymentTerms')?.kind, 'mapping_mismatch')
    assert.equal(vendors.issues[0].quickBooksId, '77')

    const accounts = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.accounts,
      sourceRows: [{ accountNo: '1100', name: 'Cash', fullName: 'Assets:Cash', parentNo: '1000', accountType: 'Bank', subType: 'CashOnHand', description: '', isActive: true }],
      importedRows: [{ accountNo: '1100', name: 'Cash', fullName: 'Assets:Cash', parentNo: '9999', accountType: 'Bank', subType: 'CashOnHand', description: '', isActive: true }, { accountNo: '9999', name: 'Extra' }],
      realmId: 'realm-1',
    })
    assert.equal(accounts.issues.some((issue) => issue.kind === 'parent_mismatch'), true)
    assert.equal(accounts.extraCount, 1)
  })

  it('detects duplicate keys and invalid enum mappings', () => {
    const moduleResult = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.items,
      sourceRows: [{ itemCode: 'SKU-1', name: 'Consulting', category: 'Services', unit: 'SVC', costPrice: 0, salePrice: 10, quantity: 0, minQuantity: 0, description: '', isActive: true }],
      importedRows: [
        { itemCode: 'SKU-1', name: 'Consulting', category: 'BadType', unit: 'SVC', costPrice: 0, salePrice: 10, quantity: 0, minQuantity: 0, description: '', isActive: true },
        { itemCode: 'SKU-1', name: 'Consulting copy' },
      ],
      realmId: 'realm-1',
    })
    assert.equal(moduleResult.duplicateCount, 1)
    assert.equal(moduleResult.issues.some((issue) => issue.kind === 'invalid_enum'), true)
    assert.equal(moduleResult.passed, false)
  })

  it('exports both successful summaries and mismatch values as CSV', () => {
    const moduleResult = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.vendors,
      sourceRows: [vendor()], importedRows: [vendor({ phone: null })], realmId: 'realm-1',
    })
    const csv = validationReportToCsv(buildQuickBooksValidationReport('realm-1', [moduleResult]))
    assert.match(csv, /Books by Bessie/)
    assert.match(csv, /\(650\) 555-7745/)
    assert.match(csv, /null_mismatch/)
  })
})

describe('QuickBooks re-import strategies', () => {
  it('handles skip, update and create strategies deterministically', () => {
    assert.equal(applyDuplicateStrategy('skip', true), 'skip')
    assert.equal(applyDuplicateStrategy('update', true), 'update')
    assert.equal(applyDuplicateStrategy('create', true), 'create')
    assert.equal(applyDuplicateStrategy('skip', false), 'import')
  })

  it('is idempotent when a repeated import uses skip', () => {
    const importedKeys = new Set<string>()
    const importOnce = (key: string) => {
      const action = applyDuplicateStrategy('skip', importedKeys.has(key))
      if (action === 'import') importedKeys.add(key)
      return action
    }
    assert.equal(importOnce('qb:realm-1:77'), 'import')
    assert.equal(importOnce('qb:realm-1:77'), 'skip')
    assert.equal(importedKeys.size, 1)
  })
})

describe('QuickBooks transaction validation', () => {
  it('validates transaction relationships, totals, and tax arithmetic', () => {
    const result = compareQuickBooksModule({
      config: VALIDATION_CONFIGS.invoices,
      sourceRows: [{ transactionNo: 'INV-1', date: '2026-07-01', customerName: 'Acme', subtotal: 100, taxAmount: 15, total: 115, currency: 'SAR' }],
      importedRows: [{ transactionNo: 'INV-1', date: '2026-07-01', customerName: 'Other Customer', subtotal: 100, taxAmount: 5, total: 105, currency: 'SAR' }],
      realmId: 'realm-1',
    })
    assert.equal(result.passed, false)
    assert.equal(result.issues.some((issue) => issue.kind === 'relationship_mismatch'), true)
    assert.equal(result.issues.some((issue) => issue.kind === 'tax_mismatch'), true)
    assert.equal(result.issues.some((issue) => issue.kind === 'total_mismatch'), true)
  })
})

describe('QuickBooks pagination', () => {
  it('fetches every page before record-count validation', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1
      const query = new URL(String(input)).searchParams.get('query') ?? ''
      const start = Number(query.match(/STARTPOSITION (\d+)/)?.[1])
      if (start === 1) return Response.json({ QueryResponse: { Customer: Array.from({ length: 1000 }, (_, index) => ({ Id: String(index + 1) })) } })
      return Response.json({ QueryResponse: { Customer: [{ Id: '1001' }] } })
    }
    const provider = new QuickBooksIntegrationService({
      clientId: 'id', clientSecret: 'secret', redirectUri: 'https://hisab.test/callback', environment: 'sandbox',
    }, fetchImpl)
    const records = await provider.getCustomers({ accessToken: 'token', realmId: 'realm-1' })
    assert.equal(records.length, 1001)
    assert.equal(calls, 2)
  })
})

describe('Migration reports', () => {
  it('calculates scores and exports module summaries as CSV', () => {
    const report = buildMigrationReport({ source: 'QuickBooks Online', durationMs: 1500, modules: [{ key: 'invoices', label: 'Invoices', sourceCount: 10, validCount: 9, warningCount: 1, validationErrors: 1, importedCount: 8, updatedCount: 1, skippedCount: 0, failedCount: 1, durationMs: 1500 }] })
    assert.equal(report.validationScore, 90)
    assert.equal(report.integrityScore, 70)
    assert.match(migrationReportToCsv(report), /Invoices/)
    assert.match(migrationReportToCsv(report), /Validation score/)
  })
})
