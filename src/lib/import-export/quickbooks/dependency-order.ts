const ORDER: Record<string, number> = {
  accounts:10,
  customers:20, vendors:20, items:20, 'tax-codes':20, 'payment-terms':20,
  projects:25, classes:25, departments:25, employees:25, 'tax-agencies':25, 'tax-configurations':26,
  'inventory-adjustments':27,
  bills:28,
  invoices:30, expenses:30, 'journal-entries':30, 'sales-receipts':30, 'purchase-orders':30, 'vendor-credits':30, estimates:30,
  'exchange-rates':35,
  'credit-memos':38, 'customer-payments':40, 'vendor-payments':40,
  deposits:50, transfers:50, attachments:60,
}

export function orderQuickBooksMigrationResources<T extends { key: string }>(resources: T[]): T[] {
  return resources.map((resource,index)=>({resource,index})).sort((left,right)=>(ORDER[left.resource.key]??35)-(ORDER[right.resource.key]??35)||left.index-right.index).map(({resource})=>resource)
}
