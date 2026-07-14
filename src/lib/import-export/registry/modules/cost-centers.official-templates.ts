import type { OfficialImportTemplate } from '../../types'

export const COST_CENTER_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Cost Centers',
    columns: [
      { header: 'Code', fieldKey: 'code', required: true, example: 'PRJ-001' },
      { header: 'Name', fieldKey: 'name', required: true, example: 'ERP Implementation' },
      { header: 'Type', fieldKey: 'type', example: 'PROJECT' },
      { header: 'Description', fieldKey: 'description', example: 'Internal ERP rollout project' },
      { header: 'Active', fieldKey: 'isActive', example: 'Yes' },
    ],
  },
  {
    id: 'classes',
    name: 'Classes (QuickBooks style)',
    columns: [
      { header: 'Class Full Name', fieldKey: 'classFullName', required: true, example: 'Administration:Office Expense' },
    ],
  },
  {
    id: 'locations',
    name: 'Locations (QuickBooks style)',
    columns: [
      { header: 'Location Full Name', fieldKey: 'locationFullName', required: true, example: 'Riyadh' },
    ],
  },
]
