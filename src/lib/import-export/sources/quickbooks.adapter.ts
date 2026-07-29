import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'
import type { ImportSourceAdapter, ImportSourceResource, NormalizedImportResource } from './types'

type JsonRecord = Record<string, unknown>

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' ? value as JsonRecord : {}
}

function value(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'boolean' ? String(value) : String(value).trim()
}

function address(record: JsonRecord): JsonRecord {
  return object(record.BillAddr ?? record.ShipAddr)
}

function contact(record: JsonRecord) {
  const location = address(record)
  return {
    name: value(record.DisplayName ?? record.CompanyName ?? record.FullyQualifiedName),
    email: value(object(record.PrimaryEmailAddr).Address),
    phone: value(object(record.PrimaryPhone).FreeFormNumber),
    address: [location.Line1, location.Line2].map(value).filter(Boolean).join(', '),
    city: value(location.City),
    country: value(location.Country),
    taxId: value(record.TaxIdentifier),
    paymentTerms: value(object(record.TermRef).name).match(/\d+/)?.[0] ?? '30',
    isActive: value(record.Active ?? true),
  }
}

const RESOURCES: ImportSourceResource[] = [
  { key: 'accounts', label: 'Chart of Accounts', moduleKey: 'accounts' },
  { key: 'customers', label: 'Customers', moduleKey: 'customers' },
  { key: 'vendors', label: 'Vendors', moduleKey: 'vendors' },
  { key: 'items', label: 'Products & Services', moduleKey: 'inventory' },
  { key: 'tax-codes', label: 'Tax Codes', moduleKey: 'tax-rates' },
  { key: 'payment-terms', label: 'Payment Terms', moduleKey: 'payment-terms' },
]

export class QuickBooksImportAdapter implements ImportSourceAdapter {
  readonly key = 'quickbooks'
  readonly label = 'QuickBooks Online'
  readonly resources = RESOURCES

  async fetchResource(provider: AccountingProvider, context: ProviderAccessContext, resourceKey: string): Promise<NormalizedImportResource> {
    const resource = this.resources.find((item) => item.key === resourceKey)
    if (!resource) throw new Error(`Unsupported QuickBooks import resource: ${resourceKey}`)

    let sourceRows: unknown[]
    switch (resourceKey) {
      case 'accounts': sourceRows = await provider.getAccounts(context); break
      case 'customers': sourceRows = await provider.getCustomers(context); break
      case 'vendors': sourceRows = await provider.getVendors(context); break
      case 'items': sourceRows = await provider.getItems(context); break
      case 'tax-codes': sourceRows = await provider.getTaxCodes(context); break
      case 'payment-terms': sourceRows = await provider.getPaymentTerms(context); break
      default: sourceRows = []
    }

    const rows = sourceRows.map((row) => this.normalize(resourceKey, object(row)))
    if (resourceKey === 'accounts') {
      const accountNoById = new Map(sourceRows.map((item) => {
        const account = object(item)
        return [value(account.Id), value(account.AcctNum) || `QB-${value(account.Id)}`]
      }))
      sourceRows.forEach((item, index) => {
        const parentId = value(object(object(item).ParentRef).value)
        rows[index].parentNo = parentId ? accountNoById.get(parentId) ?? '' : ''
      })
    }
    return { ...resource, rows }
  }

  private normalize(resourceKey: string, row: JsonRecord): Record<string, string> {
    switch (resourceKey) {
      case 'accounts': {
        return {
          accountNo: value(row.AcctNum) || `QB-${value(row.Id)}`,
          name: value(row.Name),
          fullName: value(row.FullyQualifiedName ?? row.Name),
          parentNo: '',
          accountType: value(row.AccountType),
          subType: value(row.AccountSubType ?? row.AccountType),
          description: value(row.Description),
          isActive: value(row.Active ?? true),
        }
      }
      case 'customers':
      case 'vendors': return contact(row)
      case 'items': return {
        name: value(row.Name),
        itemCode: value(row.Sku) || `QB-${value(row.Id)}`,
        description: value(row.Description ?? row.PurchaseDesc),
        category: value(row.Type) === 'Service' ? 'Services' : 'Products',
        unit: value(row.Type) === 'Service' ? 'SVC' : 'PCS',
        costPrice: value(row.PurchaseCost ?? 0),
        salePrice: value(row.UnitPrice ?? 0),
        quantity: value(row.QtyOnHand ?? 0),
        minQuantity: '0',
        isActive: value(row.Active ?? true),
      }
      case 'tax-codes': return {
        name: value(row.Name),
        rate: value(row.RateValue ?? 0),
        type: 'VAT',
        isDefault: 'false',
        isActive: value(row.Active ?? true),
      }
      case 'payment-terms': return {
        name: value(row.Name),
        days: value(row.DueDays ?? 0),
        description: value(row.Type) || `Imported from QuickBooks (${value(row.Id)})`,
        isActive: value(row.Active ?? true),
      }
      default: return {}
    }
  }
}
