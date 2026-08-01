import type { AccountingProvider, ProviderAccessContext } from '@/integrations/accounting/contracts/accounting-provider'
import { extractQuickBooksPaymentRelationships } from '../quickbooks/payment-relationships'
import type { ImportSourceAdapter, ImportSourceFetchOptions, ImportSourceResource, NormalizedImportResource } from './types'

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
  { key: 'invoices', label: 'Invoices', moduleKey: 'invoices' },
  { key: 'bills', label: 'Bills', moduleKey: 'bills' },
  { key: 'payments', label: 'Payments', moduleKey: 'customer-payments' },
  { key: 'expenses', label: 'Expenses', moduleKey: 'expenses' },
  { key: 'journal-entries', label: 'Journal Entries', moduleKey: 'journal-entries' },
  { key: 'sales-receipts', label: 'Sales Receipts', moduleKey: 'sales-receipts' },
  { key: 'purchase-orders', label: 'Purchase Orders', moduleKey: 'purchase-orders' },
  { key: 'vendor-credits', label: 'Supplier Credits', moduleKey: 'vendor-credits' },
  { key: 'estimates', label: 'Estimates', moduleKey: 'estimates' },
  { key: 'customer-payments', label: 'Customer Payments', moduleKey: 'customer-payments' },
  { key: 'vendor-payments', label: 'Vendor Payments', moduleKey: 'vendor-payments' },
  { key: 'projects', label: 'Projects', moduleKey: 'qb-projects' },
  { key: 'budgets', label: 'Budgets', moduleKey: 'qb-budgets' },
  { key: 'exchange-rates', label: 'Exchange Rates', moduleKey: 'qb-exchange-rates' },
  { key: 'classes', label: 'Classes', moduleKey: 'qb-classes' },
  { key: 'departments', label: 'Departments', moduleKey: 'qb-departments' },
  { key: 'locations', label: 'Locations', moduleKey: 'qb-locations' },
  { key: 'employees', label: 'Employees', moduleKey: 'qb-employees' },
  { key: 'time-activities', label: 'Time Activities', moduleKey: 'qb-time-activities' },
  { key: 'credit-memos', label: 'Credit Memos', moduleKey: 'qb-credit-memos' },
  { key: 'bill-payments', label: 'Bill Payments', moduleKey: 'qb-bill-payments' },
  { key: 'deposits', label: 'Deposits', moduleKey: 'qb-deposits' },
  { key: 'transfers', label: 'Transfers', moduleKey: 'qb-transfers' },
  { key: 'inventory-adjustments', label: 'Inventory Adjustments', moduleKey: 'qb-inventory-adjustments' },
  { key: 'attachments', label: 'Attachments', moduleKey: 'qb-attachments' },
  { key: 'recurring-transactions', label: 'Recurring Transactions', moduleKey: 'qb-recurring-transactions' },
  { key: 'tax-agencies', label: 'Tax Agencies', moduleKey: 'qb-tax-agencies' },
  { key: 'tax-configurations', label: 'Tax Configuration', moduleKey: 'qb-tax-configurations' },
  { key: 'preferences', label: 'Company Preferences', moduleKey: 'qb-preferences' },
  { key: 'fixed-assets', label: 'Fixed Assets', moduleKey: 'qb-fixed-assets' },
]

export const QUICKBOOKS_ENTITY_BY_RESOURCE: Record<string, string> = {
  accounts:'Account', customers:'Customer', vendors:'Vendor', items:'Item', 'tax-codes':'TaxRate', 'payment-terms':'Term',
  invoices:'Invoice', bills:'Bill', payments:'Payment', expenses:'Purchase', 'journal-entries':'JournalEntry', 'sales-receipts':'SalesReceipt',
  'purchase-orders':'PurchaseOrder', 'vendor-credits':'VendorCredit', estimates:'Estimate', 'customer-payments':'Payment', 'vendor-payments':'BillPayment',
  projects: 'Customer', budgets: 'Budget', 'exchange-rates': 'ExchangeRate', classes: 'Class', departments: 'Department', locations: 'Department', employees: 'Employee',
  'time-activities': 'TimeActivity', 'credit-memos': 'CreditMemo', 'bill-payments': 'BillPayment', deposits: 'Deposit', transfers: 'Transfer',
  'inventory-adjustments': 'InventoryAdjustment', attachments: 'Attachable', 'recurring-transactions': 'RecurringTransaction', 'tax-agencies': 'TaxAgency',
  'tax-configurations': 'TaxCode', 'fixed-assets': 'Item',
}

const PARTITIONED_RESOURCES = new Set([
  'invoices','bills','payments','expenses','journal-entries','sales-receipts','purchase-orders','vendor-credits','estimates','customer-payments','vendor-payments',
  'credit-memos','bill-payments','deposits','transfers','inventory-adjustments',
])

const SPECIAL_PREVIEW_RESOURCES = new Set([
  'accounts', 'customers', 'vendors', 'items', 'tax-codes', 'payment-terms',
  'invoices', 'bills', 'payments', 'expenses', 'journal-entries', 'sales-receipts',
  'purchase-orders', 'vendor-credits', 'estimates', 'customer-payments', 'vendor-payments',
  'preferences',
])

export function getQuickBooksPreviewSupport(resourceKey: string): { supported: boolean; message?: string } {
  const registered = RESOURCES.some((resource) => resource.key === resourceKey)
  if (!registered) return { supported: false, message: `QuickBooks resource ${resourceKey} has no adapter implementation.` }
  if (SPECIAL_PREVIEW_RESOURCES.has(resourceKey) || QUICKBOOKS_ENTITY_BY_RESOURCE[resourceKey]) return { supported: true }
  return { supported: false, message: `QuickBooks resource ${resourceKey} has no provider mapping or preview implementation.` }
}

export class QuickBooksImportAdapter implements ImportSourceAdapter {
  readonly key = 'quickbooks'
  readonly label = 'QuickBooks Online'
  readonly resources = RESOURCES

  async fetchResource(provider: AccountingProvider, context: ProviderAccessContext, resourceKey: string, options?: ImportSourceFetchOptions): Promise<NormalizedImportResource> {
    const resource = this.resources.find((item) => item.key === resourceKey)
    if (!resource) throw new Error(`Unsupported QuickBooks import resource: ${resourceKey}`)
    const fetchEntity = async (entity:string,fallback:()=>Promise<unknown[]>) => provider.getEntityRecords
      ? provider.getEntityRecords(context,entity,{
          includeInactive:true,
          partitioned:PARTITIONED_RESOURCES.has(resourceKey),
          startPosition:options?.resumeStartPosition,
          partitionStart:options?.partitionStart?new Date(options.partitionStart):undefined,
          partitionEnd:options?.partitionEnd?new Date(options.partitionEnd):undefined,
          onCheckpoint:options?.onCheckpoint?async checkpoint=>options.onCheckpoint!({...checkpoint,fetched:checkpoint.extractedCount}):undefined,
          onPage:options?.onBatch?async page=>options.onBatch!(this.normalizeRecords(resourceKey,page,context.realmId)):undefined,
        })
      : fallback()

    if (options?.preview) {
      const sampleSize = Math.min(25, Math.max(1, options.preview.sampleSize))
      if (resourceKey === 'preferences') {
        const sourceRows = provider.getPreferences ? await provider.getPreferences(context) : []
        const rows = this.normalizeRecords(resourceKey, sourceRows.slice(0, sampleSize), context.realmId)
        return { ...resource, rows, totalCount: sourceRows.length, countAccuracy: 'exact', sampled: true }
      }
      const entity = QUICKBOOKS_ENTITY_BY_RESOURCE[resourceKey]
      if (!entity || !provider.getEntityRecords) return { ...resource, rows: [], totalCount: 0, countAccuracy: 'exact', sampled: true }
      const where = resourceKey === 'projects' ? 'Job = true'
        : resourceKey === 'fixed-assets' ? "Type = 'FixedAsset'"
          : undefined
      const cacheKey = `${entity}:${where ?? 'all'}:${sampleSize}:inactive`
      let pending = options.preview.cache?.get(cacheKey)
      if (!pending) {
        pending = Promise.all([
          provider.getEntityCount ? provider.getEntityCount(context, entity, { where }) : Promise.resolve<number | null>(null),
          provider.getEntityRecords(context, entity, { includeInactive:true, pageSize:sampleSize, maxRecords:sampleSize, where }),
        ]).then(([count, rows]) => ({ count: count ?? rows.length, rows }))
        options.preview.cache?.set(cacheKey, pending)
      }
      const preview = await pending
      let sourceRows = preview.rows
      if (resourceKey === 'projects') sourceRows = sourceRows.filter(row => Boolean(object(row).Job) || Boolean(object(row).ParentRef))
      if (resourceKey === 'fixed-assets') sourceRows = sourceRows.filter(row => value(object(row).Type).toLowerCase() === 'fixedasset')
      const rows = this.normalizeRecords(resourceKey, sourceRows.slice(0, sampleSize), context.realmId)
      return { ...resource, rows, totalCount: preview.count, countAccuracy: 'exact', sampled: true }
    }

    let sourceRows: unknown[]
    switch (resourceKey) {
      case 'accounts': sourceRows = await provider.getAccounts(context); break
      case 'customers': sourceRows = await provider.getCustomers(context); break
      case 'vendors': sourceRows = await provider.getVendors(context); break
      case 'items': sourceRows = await provider.getItems(context); break
      case 'tax-codes': sourceRows = provider.getTaxRates
        ? await provider.getTaxRates(context)
        : provider.getEntityRecords
          ? await provider.getEntityRecords(context, 'TaxRate')
          : []; break
      case 'payment-terms': sourceRows = await provider.getPaymentTerms(context); break
      case 'invoices': sourceRows = await fetchEntity('Invoice',()=>provider.getInvoices(context)); break
      case 'bills': sourceRows = await fetchEntity('Bill',()=>provider.getBills(context)); break
      case 'payments': sourceRows = await fetchEntity('Payment',()=>provider.getPayments(context)); break
      case 'expenses': sourceRows = await fetchEntity('Purchase',()=>provider.getExpenses?.(context)??Promise.resolve([])); break
      case 'journal-entries': sourceRows = await fetchEntity('JournalEntry',()=>provider.getJournalEntries?.(context)??Promise.resolve([])); break
      case 'sales-receipts': sourceRows = await fetchEntity('SalesReceipt',()=>provider.getSalesReceipts?.(context)??Promise.resolve([])); break
      case 'purchase-orders': sourceRows = await fetchEntity('PurchaseOrder',()=>provider.getPurchaseOrders?.(context)??Promise.resolve([])); break
      case 'vendor-credits': sourceRows = await fetchEntity('VendorCredit',()=>provider.getVendorCredits?.(context)??Promise.resolve([])); break
      case 'estimates': sourceRows = await fetchEntity('Estimate',()=>provider.getEstimates?.(context)??Promise.resolve([])); break
      case 'customer-payments': sourceRows = await fetchEntity('Payment',()=>provider.getCustomerPayments?.(context)??Promise.resolve([])); break
      case 'vendor-payments': sourceRows = await fetchEntity('BillPayment',()=>provider.getVendorPayments?.(context)??Promise.resolve([])); break
      case 'preferences': sourceRows = provider.getPreferences ? await provider.getPreferences(context) : []; break
      default: {
        const entity = QUICKBOOKS_ENTITY_BY_RESOURCE[resourceKey]
        if (!entity || !provider.getEntityRecords) sourceRows = []
        else sourceRows = await fetchEntity(entity,async()=>[])
      }
    }

    if (resourceKey === 'projects') sourceRows = sourceRows.filter(row => Boolean(object(row).Job) || Boolean(object(row).ParentRef))
    if (resourceKey === 'fixed-assets') sourceRows = sourceRows.filter(row => value(object(row).Type).toLowerCase() === 'fixedasset')

    const rows = this.normalizeRecords(resourceKey, sourceRows, context.realmId)
    if (resourceKey === 'attachments' && provider.downloadAttachment && options?.companyId) {
      for (let index = 0; index < sourceRows.length; index += 5) {
        await Promise.all(sourceRows.slice(index, index + 5).map(async (item, batchIndex) => {
          const source = object(item)
          const id = value(source.Id)
          if (!id) return
          const download = await provider.downloadAttachment!(context, id)
          const response = download.content ? null : await fetch(download.url, { signal: AbortSignal.timeout(60_000) })
          if (response && !response.ok) throw new Error(`QuickBooks attachment ${id} download failed (${response.status}).`)
          const content = download.content ? new Uint8Array(download.content) : new Uint8Array(await response!.arrayBuffer())
          const fileName = value(source.FileName) || `quickbooks-${id}`
          const mimeType = download.contentType ?? response?.headers.get('content-type') ?? 'application/octet-stream'
          const { storeQuickBooksAttachment } = await import('../quickbooks/attachment-storage')
          const storagePath = await storeQuickBooksAttachment({ companyId:options.companyId!, realmId:context.realmId, id, fileName, mimeType, content })
          rows[index + batchIndex]._hisabAttachment = JSON.stringify({ storagePath, fileName, mimeType })
        }))
      }
    }
    return { ...resource, rows }
  }

  normalizeRecords(resourceKey: string, sourceRows: unknown[], realmId: string): Record<string, string>[] {
    const rows: Record<string, string>[] = sourceRows.map((row) => {
      const source = object(row)
      const syntheticId = resourceKey === 'preferences' ? 'Preferences' : value(source.Id)
      return {
        ...this.normalize(resourceKey, source),
        sourceId: value(source.Id) || (resourceKey === 'preferences' ? 'Preferences' : this.normalize(resourceKey, source).sourceId),
        _quickbooksId: syntheticId,
        _quickbooksEntity: QUICKBOOKS_ENTITY_BY_RESOURCE[resourceKey] ?? resourceKey,
        _realmId: realmId,
        _syncToken: value(source.SyncToken),
        _quickbooksRaw: JSON.stringify(source),
        _quickbooksMeta: JSON.stringify(object(source.MetaData)),
        _linkedTransactions: JSON.stringify(Array.isArray(source.LinkedTxn) ? source.LinkedTxn : []),
        _customFields: JSON.stringify(Array.isArray(source.CustomField) ? source.CustomField : []),
        _active: value(source.Active ?? true),
        _deleted: value(source.status).toLowerCase() === 'deleted' ? 'true' : 'false',
      }
    })
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
    return rows
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
      case 'invoices':
      case 'bills':
      case 'payments':
      case 'expenses':
      case 'journal-entries':
      case 'sales-receipts':
      case 'purchase-orders':
      case 'vendor-credits':
      case 'estimates':
      case 'customer-payments':
      case 'vendor-payments': return normalizeTransaction(resourceKey, row)
      case 'payment-terms': return {
        name: value(row.Name),
        days: value(row.DueDays ?? 0),
        description: value(row.Type) || `Imported from QuickBooks (${value(row.Id)})`,
        isActive: value(row.Active ?? true),
      }
      default: return normalizeExtended(resourceKey, row)
    }
  }
}

function normalizeExtended(resourceKey: string, row: JsonRecord): Record<string, string> {
  const meta = object(row.MetaData)
  const currency = object(row.CurrencyRef)
  const parent = object(row.ParentRef)
  const entity = object(row.EntityRef)
  const account = object(row.AccountRef ?? row.AdjustmentAccountRef)
  return {
    sourceId: value(row.Id),
    name: value(row.DisplayName ?? row.Name ?? row.DocNumber ?? `${resourceKey}-${value(row.Id)}`),
    code: value(row.AcctNum ?? row.DocNumber ?? row.Sku) || `QB-${value(row.Id)}`,
    type: value(row.Type ?? row.TxnType ?? resourceKey),
    date: value(row.TxnDate ?? meta.CreateTime),
    updatedAt: value(meta.LastUpdatedTime),
    amount: value(row.TotalAmt ?? row.Amount ?? row.Rate ?? row.CurrentBalance ?? 0),
    currency: value(currency.value ?? currency.name),
    exchangeRate: value(row.ExchangeRate ?? row.Rate ?? 1),
    parentSourceId: value(parent.value),
    entitySourceId: value(entity.value),
    accountSourceId: value(account.value),
    status: value(row.TxnStatus ?? row.Status ?? (row.Active === false ? 'INACTIVE' : 'ACTIVE')),
    description: value(row.Description ?? row.PrivateNote ?? row.Note),
    lines: JSON.stringify(Array.isArray(row.Line) ? row.Line : []),
  }
}

function normalizeTransaction(resourceKey: string, row: JsonRecord): Record<string, string> {
  const customer = object(row.CustomerRef)
  const vendor = object(row.VendorRef)
  const entity = object(row.EntityRef)
  const transactionLines = Array.isArray(row.Line) ? row.Line : Array.isArray(row.JournalEntryLine) ? row.JournalEntryLine : []
  const linkedCandidates = [
    ...(Array.isArray(row.LinkedTxn) ? row.LinkedTxn : []),
    ...transactionLines.flatMap(line => Array.isArray(object(line).LinkedTxn) ? object(line).LinkedTxn as unknown[] : []),
  ]
  const linked = linkedCandidates.length ? object(linkedCandidates[0]) : {}
  const lines = transactionLines.map((line) => {
    const valueLine = object(line)
    const detail = object(valueLine.SalesItemLineDetail ?? valueLine.PurchaseItemLineDetail ?? valueLine.ItemBasedExpenseLineDetail ?? valueLine.AccountBasedExpenseLineDetail ?? valueLine.JournalEntryLineDetail)
    const item = object(detail.ItemRef)
    const account = object(detail.AccountRef ?? valueLine.AccountRef)
    return {
      sourceLineId: value(valueLine.Id),
      detailType: value(valueLine.DetailType),
      description: value(valueLine.Description),
      quantity: value(detail.Qty ?? 1),
      unitPrice: value(detail.UnitPrice ?? 0),
      amount: value(valueLine.Amount ?? 0),
      taxRate: value(object(valueLine.TaxCodeRef).value ?? 0),
      itemCode: value(item.name ?? item.value),
      itemSourceId: value(item.value),
      accountNo: value(account.name ?? account.value),
      accountSourceId: value(account.value),
      classSourceId: value(object(detail.ClassRef).value),
      taxCodeSourceId: value(object(detail.TaxCodeRef ?? valueLine.TaxCodeRef).value),
      debit: value(detail.PostingType === 'Debit' ? valueLine.Amount ?? 0 : valueLine.Debit ?? 0),
      credit: value(detail.PostingType === 'Credit' ? valueLine.Amount ?? 0 : valueLine.Credit ?? 0),
    }
  })
  const journalTotal = resourceKey === 'journal-entries' ? lines.reduce((sum,line)=>sum+Number(line.debit||0),0) : 0
  const total = value(row.TotalAmt ?? row.Amount ?? journalTotal)
  const transactionTax = value(object(row.TxnTaxDetail).TotalTax ?? 0)
  const paymentKind = resourceKey === 'customer-payments' || resourceKey === 'payments' ? 'CUSTOMER' : resourceKey === 'vendor-payments' ? 'VENDOR' : null
  const paymentRelationships = paymentKind ? extractQuickBooksPaymentRelationships(row,paymentKind) : null
  return {
    transactionNo: value(row.DocNumber) || `QB-${value(row.Id)}`,
    sourceId: value(row.Id),
    date: value(row.TxnDate ?? row.TxnDateTime),
    dueDate: value(row.DueDate ?? row.TxnDate),
    expiryDate: value(row.ExpirationDate),
    expectedDate: value(row.ExpectedDate),
    customerName: value(customer.name ?? customer.value ?? entity.name ?? entity.value),
    customerSourceId: value(customer.value ?? entity.value),
    vendorName: value(vendor.name ?? vendor.value),
    vendorSourceId: value(vendor.value),
    amount: total,
    subtotal: value(row.SubTotal ?? (Number(total) - Number(transactionTax))),
    taxAmount: transactionTax,
    total,
    status: nativeTransactionStatus(resourceKey,row),
    currency: value(object(row.CurrencyRef).value ?? 'SAR'),
    exchangeRate: value(row.ExchangeRate ?? 1),
    homeTotal: value(row.HomeTotalAmt ?? (Number(total) * Number(row.ExchangeRate ?? 1))),
    reference: value(row.PrivateNote ?? row.PaymentRefNum ?? row.DocNumber),
    relatedSourceId: value(linked.TxnId),
    allocations: paymentRelationships ? JSON.stringify(paymentRelationships.allocations) : '[]',
    unappliedAmount: value(paymentRelationships?.unappliedAmount ?? 0),
    relationshipIssues: paymentRelationships ? JSON.stringify(paymentRelationships.issues) : '[]',
    description: value(row.PrivateNote ?? row.CustomerMemo),
    category: resourceKey === 'expenses' ? 'Other' : '',
    paymentMethod: value(object(row.PaymentMethodRef).name ?? 'Cash'),
    paymentMethodSourceId: value(object(row.PaymentMethodRef).value),
    depositAccountSourceId: value(object(row.DepositToAccountRef).value),
    apAccountSourceId: value(object(row.APAccountRef).value),
    lines: JSON.stringify(lines),
  }
}

function nativeTransactionStatus(resourceKey:string,row:JsonRecord) {
  const balance = Number(row.Balance ?? row.TotalAmt ?? row.Amount ?? 0)
  const total = Number(row.TotalAmt ?? row.Amount ?? 0)
  if (resourceKey === 'invoices') return balance <= 0 ? 'PAID' : balance < total ? 'PARTIAL' : 'SENT'
  if (resourceKey === 'bills') return balance <= 0 ? 'PAID' : balance < total ? 'PARTIAL' : 'RECEIVED'
  if (resourceKey === 'expenses') return 'APPROVED'
  if (resourceKey === 'journal-entries') return 'DRAFT'
  if (resourceKey === 'sales-receipts') return 'POSTED'
  if (resourceKey === 'purchase-orders') return value(row.POStatus ?? row.Status ?? 'OPEN').toUpperCase()
  if (resourceKey === 'vendor-credits') return balance <= 0 ? 'CLOSED' : balance < total ? 'PARTIAL' : 'OPEN'
  if (resourceKey === 'estimates') return value(row.TxnStatus ?? row.Status ?? 'OPEN').toUpperCase()
  return value(row.TxnStatus ?? row.Status ?? 'POSTED').toUpperCase()
}
