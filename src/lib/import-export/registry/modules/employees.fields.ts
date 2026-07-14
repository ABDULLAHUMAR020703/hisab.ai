import type { FieldDefinition } from '../../types'

export const EMPLOYEE_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string', required: true, exportOrder: 1 },
  { key: 'email', label: 'Email', type: 'email', exportOrder: 2 },
  { key: 'phone', label: 'Phone', type: 'phone', exportOrder: 3 },
  { key: 'department', label: 'Department', type: 'string', exportOrder: 4 },
  { key: 'position', label: 'Position', type: 'string', exportOrder: 5 },
  { key: 'joiningDate', label: 'Joining Date', type: 'date', required: true, exportOrder: 6 },
  { key: 'salary', label: 'Salary', type: 'currency', exportOrder: 7 },
  { key: 'salaryType', label: 'Salary Type', type: 'string', exportOrder: 8, description: 'MONTHLY or HOURLY' },
  { key: 'bankAccount', label: 'Bank Account', type: 'string', exportOrder: 9 },
  { key: 'isActive', label: 'Active', type: 'boolean', exportOrder: 10 },
  { key: 'employeeNo', label: 'Employee #', type: 'string', importable: false, exportOrder: 0 },
]
