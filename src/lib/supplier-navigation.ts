export type SupplierLinkTarget = 'bill' | 'expense' | 'cheque' | 'purchase-order' | 'item-receipt'

export interface SupplierLinkData {
  id: string
  name: string
  paymentTerms?: number
  address?: string | null
  currency?: string
}

/** Builds the shared supplier context used by expense-side creation flows. */
export function supplierTransactionHref(target: SupplierLinkTarget, supplier: SupplierLinkData) {
  const params = new URLSearchParams({
    new: '1',
    supplierId: supplier.id,
    supplierName: supplier.name,
  })
  if (supplier.paymentTerms) params.set('paymentTerms', String(supplier.paymentTerms))
  if (supplier.address) params.set('supplierAddress', supplier.address)
  if (supplier.currency) params.set('currency', supplier.currency)

  const path = {
    bill: '/bills',
    expense: '/expenses',
    cheque: '/banking?tab=cheques',
    'purchase-order': '/purchase-orders',
    'item-receipt': '/receipts',
  }[target]
  return `${path}${path.includes('?') ? '&' : '?'}${params}`
}
