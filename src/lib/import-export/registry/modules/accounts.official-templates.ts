import type { OfficialImportTemplate } from '../../types'

export const ACCOUNT_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Chart of Accounts',
    columns: [
      { header: 'Account No.', fieldKey: 'accountNo', required: true, example: '32-3201-320101' },
      { header: 'Full Name', fieldKey: 'fullName', required: true, example: 'CASH AND BANK:CASH IN HAND' },
      { header: 'Account Type', fieldKey: 'accountType', required: true, example: 'Bank' },
      { header: 'Account Subtype', fieldKey: 'subType', required: true, example: 'Cash on Hand' },
    ],
  },
]
