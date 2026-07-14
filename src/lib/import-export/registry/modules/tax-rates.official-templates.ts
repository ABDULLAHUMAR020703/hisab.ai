import type { OfficialImportTemplate } from '../../types'

export const TAX_RATE_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Tax Rates',
    columns: [
      { header: 'Tax Name', fieldKey: 'name', required: true, example: 'Standard VAT (15%)' },
      { header: 'Rate', fieldKey: 'rate', required: true, example: '15' },
      { header: 'Type', fieldKey: 'type', example: 'VAT' },
      { header: 'Description', fieldKey: 'taxDescription', example: 'Saudi Arabia standard VAT rate' },
      { header: 'Status', fieldKey: 'isActive', example: 'Active' },
    ],
  },
]
