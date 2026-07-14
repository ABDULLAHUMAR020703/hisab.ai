import type { FieldDefinition } from '../../types'

export const CUSTOMER_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 1 },
  { key: 'email', label: 'Email', type: 'email', exportOrder: 2 },
  { key: 'phone', label: 'Phone', type: 'phone', exportOrder: 3 },
  { key: 'address', label: 'Address', type: 'string', exportOrder: 4 },
  { key: 'city', label: 'City', type: 'string', exportOrder: 5 },
  { key: 'country', label: 'Country', type: 'string', exportOrder: 6 },
  { key: 'taxId', label: 'Tax ID / VAT', type: 'vat', exportOrder: 7 },
  { key: 'creditLimit', label: 'Credit Limit', type: 'currency', exportOrder: 8 },
  { key: 'paymentTerms', label: 'Payment Terms (days)', type: 'number', exportOrder: 9 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 10 },
  { key: 'customerNo', label: 'Customer #', type: 'string', importable: false, exportOrder: 0 },
]
