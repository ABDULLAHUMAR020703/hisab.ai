import type { FieldDefinition } from '../../types'

export const COST_CENTER_FIELDS: FieldDefinition[] = [
  { key: 'code', label: 'Code', type: 'string', required: true, exportOrder: 1 },
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 2 },
  { key: 'type', label: 'Type', type: 'string', exportOrder: 3, description: 'LOCATION, CLASS, or PROJECT' },
  { key: 'description', label: 'Description', type: 'string', exportOrder: 4 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 5 },
]
