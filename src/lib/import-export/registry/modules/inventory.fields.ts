import type { FieldDefinition } from '../../types'

export const INVENTORY_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 1 },
  { key: 'itemCode', label: 'Item Code', type: 'string', exportOrder: 2 },
  { key: 'description', label: 'Description', type: 'string', exportOrder: 3 },
  { key: 'category', label: 'Category', type: 'string', exportOrder: 4 },
  { key: 'unit', label: 'Unit', type: 'string', exportOrder: 5 },
  { key: 'costPrice', label: 'Cost Price', type: 'currency', exportOrder: 6 },
  { key: 'salePrice', label: 'Sale Price', type: 'currency', exportOrder: 7 },
  { key: 'quantity', label: 'Quantity', type: 'number', exportOrder: 8 },
  { key: 'minQuantity', label: 'Min Quantity', type: 'number', exportOrder: 9 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 10 },
]
