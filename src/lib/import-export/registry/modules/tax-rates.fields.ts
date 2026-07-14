import type { FieldDefinition } from '../../types'

export const TAX_RATE_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 1 },
  { key: 'rate', label: 'Rate (%)', type: 'number', required: true, exportOrder: 2 },
  { key: 'type', label: 'Type', type: 'string', exportOrder: 3, description: 'VAT or other' },
  { key: 'isDefault', label: 'Default', type: 'boolean', exportOrder: 4 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 5 },
]
