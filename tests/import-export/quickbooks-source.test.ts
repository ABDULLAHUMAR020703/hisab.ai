import assert from 'node:assert/strict'
import test from 'node:test'
import { QuickBooksImportAdapter } from '../../src/lib/import-export/sources/quickbooks.adapter'
import type { AccountingProvider } from '../../src/integrations/accounting/contracts/accounting-provider'
import { Provider } from '../../src/integrations/accounting/contracts/types'

const rows: Record<string, unknown[]> = {
  accounts: [{ Id: '7', Name: 'Sales', FullyQualifiedName: 'Income:Sales', AccountType: 'Income', AccountSubType: 'SalesOfProductIncome', Active: true }],
  customers: [{ DisplayName: 'Acme', PrimaryEmailAddr: { Address: 'team@acme.test' }, BillAddr: { Line1: 'Main St', City: 'Riyadh', Country: 'Saudi Arabia' } }],
  vendors: [], items: [], taxCodes: [], terms: [],
}

const provider: AccountingProvider = {
  slug: Provider.QUICKBOOKS,
  async connect() { return { authorizationUrl: '' } },
  async exchangeAuthorizationCode() { throw new Error('not used') },
  async disconnect() {}, async refreshToken() { throw new Error('not used') },
  async validateConnection() { return true }, async getCompanyInfo() { return { realmId: '1', companyName: null, companyEmail: null, country: null, baseCurrency: null, timezone: null, legalName: null } },
  async getCustomers() { return rows.customers }, async getVendors() { return rows.vendors },
  async getInvoices() { return [] }, async getBills() { return [] }, async getPayments() { return [] },
  async getAccounts() { return rows.accounts }, async getItems() { return rows.items },
  async getTaxCodes() { return rows.taxCodes }, async getPaymentTerms() { return rows.terms },
}

test('QuickBooks source exposes all Phase 3 resources', () => {
  assert.deepEqual(new QuickBooksImportAdapter().resources.map((item) => item.key), [
    'accounts', 'customers', 'vendors', 'items', 'tax-codes', 'payment-terms',
  ])
})

test('QuickBooks accounts normalize to the existing accounts module fields', async () => {
  const result = await new QuickBooksImportAdapter().fetchResource(provider, { accessToken: 'x', realmId: '1' }, 'accounts')
  assert.deepEqual(result.rows[0], {
    accountNo: 'QB-7', name: 'Sales', fullName: 'Income:Sales', parentNo: '', accountType: 'Income',
    subType: 'SalesOfProductIncome', description: '', isActive: 'true',
  })
})

test('QuickBooks contacts normalize nested email and address values', async () => {
  const result = await new QuickBooksImportAdapter().fetchResource(provider, { accessToken: 'x', realmId: '1' }, 'customers')
  assert.equal(result.rows[0].email, 'team@acme.test')
  assert.equal(result.rows[0].city, 'Riyadh')
})
