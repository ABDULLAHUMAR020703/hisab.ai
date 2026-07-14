import type { OfficialImportTemplate } from '../../types'

export const CUSTOMER_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Customers',
    columns: [
      { header: 'Customer Name', fieldKey: 'name', required: true, example: 'Al Rajhi Trading Establishment' },
      { header: 'Customer Number', fieldKey: 'customerNo', example: 'CUST-00001' },
      { header: 'Email', fieldKey: 'email', example: 'billing@alrajhi.com.sa' },
      { header: 'Phone', fieldKey: 'phone', example: '+966501234567' },
      { header: 'VAT Number', fieldKey: 'taxId', example: '310123456789003' },
      { header: 'Address', fieldKey: 'address', example: 'King Fahd Road, Olaya District' },
      { header: 'City', fieldKey: 'city', example: 'Riyadh' },
      { header: 'Country', fieldKey: 'country', example: 'Saudi Arabia' },
      { header: 'Credit Limit', fieldKey: 'creditLimit', example: '50000' },
      { header: 'Payment Terms', fieldKey: 'paymentTerms', example: '30' },
    ],
  },
]
