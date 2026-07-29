import type { FieldDefinition } from '../../types'

export const PAYMENT_TERM_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 1 },
  { key: 'days', label: 'Due Days', type: 'number', required: true, exportOrder: 2 },
  { key: 'description', label: 'Description', type: 'string', exportOrder: 3 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 4 },
]
