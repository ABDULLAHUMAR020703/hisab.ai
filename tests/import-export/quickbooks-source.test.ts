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

test('QuickBooks source exposes master data and transaction resources', () => {
  assert.deepEqual(new QuickBooksImportAdapter().resources.map((item) => item.key), [
    'accounts', 'customers', 'vendors', 'items', 'tax-codes', 'payment-terms',
    'invoices', 'bills', 'expenses', 'journal-entries', 'sales-receipts',
    'purchase-orders', 'vendor-credits', 'estimates', 'customer-payments', 'vendor-payments',
    'projects', 'budgets', 'exchange-rates', 'classes', 'departments', 'employees',
    'time-activities', 'credit-memos', 'deposits', 'transfers',
    'inventory-adjustments', 'attachments', 'recurring-transactions', 'tax-agencies',
    'tax-configurations', 'preferences', 'fixed-assets',
  ])
})

test('QuickBooks accounts normalize to the existing accounts module fields', async () => {
  const result = await new QuickBooksImportAdapter().fetchResource(provider, { accessToken: 'x', realmId: '1' }, 'accounts')
  assert.equal(result.rows[0].accountNo, 'QB-7')
  assert.equal(result.rows[0].name, 'Sales')
  assert.equal(result.rows[0]._quickbooksId, '7')
  assert.equal(result.rows[0]._realmId, '1')
  assert.deepEqual(JSON.parse(result.rows[0]._quickbooksRaw), rows.accounts[0])
})

test('QuickBooks service lines derive unit price from amount when quantity and unit price are omitted',()=>{
  const adapter=new QuickBooksImportAdapter()
  const [invoice]=adapter.normalizeRecords('invoices',[{Id:'27',TotalAmt:103.55,Balance:0,Line:[{Id:'1',Amount:103.55,DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{value:'1'}}},{Amount:103.55,DetailType:'SubTotalLineDetail',SubTotalLineDetail:{}}]}],'realm-1')
  const lines=JSON.parse(invoice.lines) as Array<{detailType:string;quantity:string;unitPrice:string}>
  assert.equal(lines[0].quantity,'1')
  assert.equal(lines[0].unitPrice,'103.55')
  assert.equal(lines[1].unitPrice,'0')
})

test('QuickBooks contacts normalize nested email and address values', async () => {
  const result = await new QuickBooksImportAdapter().fetchResource(provider, { accessToken: 'x', realmId: '1' }, 'customers')
  assert.equal(result.rows[0].email, 'team@acme.test')
  assert.equal(result.rows[0].city, 'Riyadh')
})

test('QuickBooks contacts select one valid canonical email while preserving multi-address source metadata', async () => {
  const [normalized] = new QuickBooksImportAdapter().normalizeRecords('vendors', [{
    Id: '45',
    DisplayName: 'National Eye Care',
    PrimaryEmailAddr: { Address: 'Nateyecare@intuit.com, pauliejones15@intuit.com' },
  }], 'sandbox-realm')

  assert.equal(normalized.email, 'Nateyecare@intuit.com')
  assert.match(String(normalized._quickbooksRaw), /pauliejones15@intuit\.com/)
})

test('Company Preferences is a terminal non-paginated source resource', async () => {
  const preferenceProvider: AccountingProvider = {
    ...provider,
    async getPreferences() {
      return [{ CurrencyPrefs: { HomeCurrency: { value: 'USD' } } }]
    },
  }
  const result = await new QuickBooksImportAdapter().fetchResource(preferenceProvider, { accessToken: 'x', realmId: '1' }, 'preferences')
  assert.equal(result.rows.length, 1)
  assert.equal(result.hasMore, false)
})

test('Fixed Assets preview treats an unavailable Sandbox Item query as zero records', async () => {
  const requests: Array<{ entity: string; options: unknown }> = []
  const fixedAssetProvider: AccountingProvider = {
    ...provider,
    async getEntityCount(_context, entity, options) {
      requests.push({ entity, options: options ?? {} })
      throw Object.assign(new Error('QuickBooks data request failed (400).'), {
        statusCode: 400,
        cause: { quickBooksStatus: 400, responseBody: '{"Fault":"FixedAsset is not supported"}' },
      })
    },
    async getEntityRecords(_context, entity, options) {
      requests.push({ entity, options: options ?? {} })
      throw Object.assign(new Error('QuickBooks data request failed (400).'), {
        statusCode: 400,
        cause: { quickBooksStatus: 400, responseBody: '{"Fault":"FixedAsset is not supported"}' },
      })
    },
  }

  const result = await new QuickBooksImportAdapter().fetchResource(
    fixedAssetProvider,
    { accessToken: 'x', realmId: 'sandbox-realm' },
    'fixed-assets',
    { preview: { sampleSize: 10, cache: new Map() } },
  )

  assert.equal(result.totalCount, 0)
  assert.deepEqual(result.rows, [])
  assert.deepEqual(requests.map((request) => request.entity), ['Item', 'Item'])
  assert.equal((requests[0].options as { where?: string }).where, "Type = 'FixedAsset'")
})
