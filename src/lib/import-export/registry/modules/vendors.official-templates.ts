import type { OfficialImportTemplate } from '../../types'

export const VENDOR_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Vendors',
    columns: [
      { header: 'Vendor Name', fieldKey: 'name', required: true, example: 'Gulf Petrochemical Supplies' },
      { header: 'Contact Person', fieldKey: 'contactPerson', example: 'Ahmed Al-Otaibi' },
      { header: 'Email', fieldKey: 'email', example: 'procurement@gulfpetro.com.sa' },
      { header: 'Phone', fieldKey: 'phone', example: '+966501987654' },
      { header: 'VAT Number', fieldKey: 'taxId', example: '310123456789003' },
      { header: 'Address', fieldKey: 'address', example: 'King Saud Street, Al Faisaliyah' },
      { header: 'City', fieldKey: 'city', example: 'Dammam' },
      { header: 'Country', fieldKey: 'country', example: 'Saudi Arabia' },
      { header: 'Payment Terms', fieldKey: 'paymentTerms', example: '30' },
    ],
  },
]
