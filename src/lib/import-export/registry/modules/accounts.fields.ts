import type { FieldDefinition } from '../../types'

export const ACCOUNT_FIELDS: FieldDefinition[] = [
  { key: 'accountNo', label: 'Account No', type: 'string', required: true, exportOrder: 1 },
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 2 },
  { key: 'fullName', label: 'Full Name', type: 'string', exportOrder: 3 },
  { key: 'parentNo', label: 'Parent Account No', type: 'string', exportOrder: 4 },
  { key: 'accountType', label: 'Account Type', type: 'string', required: true, exportOrder: 5 },
  { key: 'subType', label: 'Sub Type', type: 'string', required: true, exportOrder: 6 },
  { key: 'description', label: 'Description', type: 'string', exportOrder: 7 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 8 },
]
