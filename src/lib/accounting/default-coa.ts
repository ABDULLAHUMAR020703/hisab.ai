import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAccountClassification } from './account-type-map'

export interface DefaultCoaRow {
  accountNo: string
  fullName: string
  name: string
  parentNo: string | null
  accountType: string
  subType: string
}

export const DEFAULT_COA_TEMPLATE: DefaultCoaRow[] = [
  { accountNo: '1', fullName: 'ASSETS', name: 'ASSETS', parentNo: null, accountType: 'Asset', subType: 'Header' },
  { accountNo: '11', fullName: 'ASSETS:Current Assets', name: 'Current Assets', parentNo: '1', accountType: 'Other Current Asset', subType: 'Other Current Asset' },
  { accountNo: '11-1101', fullName: 'ASSETS:Current Assets:Cash and Bank', name: 'Cash and Bank', parentNo: '11', accountType: 'Bank', subType: 'Cash and Cash Equivalents' },
  { accountNo: '11-1102', fullName: 'ASSETS:Current Assets:Accounts Receivable', name: 'Accounts Receivable', parentNo: '11', accountType: 'Accounts Receivable', subType: 'Accounts Receivable' },
  { accountNo: '11-1103', fullName: 'ASSETS:Current Assets:Inventory Asset', name: 'Inventory Asset', parentNo: '11', accountType: 'Other Current Asset', subType: 'Inventory' },
  { accountNo: '11-1104', fullName: 'ASSETS:Current Assets:VAT Receivable', name: 'VAT Receivable', parentNo: '11', accountType: 'Other Current Asset', subType: 'Other Current Asset' },
  { accountNo: '2', fullName: 'LIABILITIES', name: 'LIABILITIES', parentNo: null, accountType: 'Liability', subType: 'Header' },
  { accountNo: '21', fullName: 'LIABILITIES:Current Liabilities', name: 'Current Liabilities', parentNo: '2', accountType: 'Other Current Liability', subType: 'Other Current Liability' },
  { accountNo: '21-2101', fullName: 'LIABILITIES:Current Liabilities:Accounts Payable', name: 'Accounts Payable', parentNo: '21', accountType: 'Accounts Payable', subType: 'Accounts Payable' },
  { accountNo: '21-2102', fullName: 'LIABILITIES:Current Liabilities:VAT Payable', name: 'VAT Payable', parentNo: '21', accountType: 'Other Current Liability', subType: 'Other Current Liability' },
  { accountNo: '3', fullName: 'EQUITY', name: 'EQUITY', parentNo: null, accountType: 'Equity', subType: 'Header' },
  { accountNo: '31', fullName: 'EQUITY:Owner Equity', name: 'Owner Equity', parentNo: '3', accountType: 'Equity', subType: 'Equity' },
  { accountNo: '31-3101', fullName: 'EQUITY:Owner Equity:Retained Earnings', name: 'Retained Earnings', parentNo: '31', accountType: 'Equity', subType: 'Equity' },
  { accountNo: '4', fullName: 'INCOME', name: 'INCOME', parentNo: null, accountType: 'Income', subType: 'Header' },
  { accountNo: '41', fullName: 'INCOME:Sales Income', name: 'Sales Income', parentNo: '4', accountType: 'Income', subType: 'Income' },
  { accountNo: '41-4101', fullName: 'INCOME:Sales Income:Product Sales', name: 'Product Sales', parentNo: '41', accountType: 'Income', subType: 'Income' },
  { accountNo: '41-4103', fullName: 'INCOME:Sales Income:Realized FX Gain', name: 'Realized FX Gain', parentNo: '41', accountType: 'Income', subType: 'Income' },
  { accountNo: '41-4104', fullName: 'INCOME:Sales Income:Unrealized FX Gain', name: 'Unrealized FX Gain', parentNo: '41', accountType: 'Income', subType: 'Income' },
  { accountNo: '5', fullName: 'COST OF GOODS SOLD', name: 'COST OF GOODS SOLD', parentNo: null, accountType: 'Cost of Goods Sold', subType: 'Header' },
  { accountNo: '51', fullName: 'COST OF GOODS SOLD:Direct Costs', name: 'Direct Costs', parentNo: '5', accountType: 'Cost of Goods Sold', subType: 'Cost of Goods Sold' },
  { accountNo: '6', fullName: 'EXPENSES', name: 'EXPENSES', parentNo: null, accountType: 'Expenses', subType: 'Header' },
  { accountNo: '61', fullName: 'EXPENSES:Operating Expenses', name: 'Operating Expenses', parentNo: '6', accountType: 'Expenses', subType: 'Expenses' },
  { accountNo: '61-6101', fullName: 'EXPENSES:Operating Expenses:Rent', name: 'Rent', parentNo: '61', accountType: 'Expenses', subType: 'Expenses' },
  { accountNo: '61-6102', fullName: 'EXPENSES:Operating Expenses:Salaries', name: 'Salaries', parentNo: '61', accountType: 'Expenses', subType: 'Expenses' },
  { accountNo: '61-6103', fullName: 'EXPENSES:Operating Expenses:Utilities', name: 'Utilities', parentNo: '61', accountType: 'Expenses', subType: 'Expenses' },
  { accountNo: '61-6104', fullName: 'EXPENSES:Operating Expenses:Realized FX Loss', name: 'Realized FX Loss', parentNo: '61', accountType: 'Expenses', subType: 'Expenses' },
  { accountNo: '61-6105', fullName: 'EXPENSES:Operating Expenses:Unrealized FX Loss', name: 'Unrealized FX Loss', parentNo: '61', accountType: 'Expenses', subType: 'Expenses' },
]

export async function seedDefaultChartOfAccounts(companyId: string): Promise<number> {
  const client = createAdminClient()

  const { count } = await client
    .from('chart_of_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('deleted_at', null)

  if ((count ?? 0) > 0) return 0

  const idByAccountNo = new Map<string, string>()
  let inserted = 0

  for (const row of DEFAULT_COA_TEMPLATE) {
    const { canonicalType, normalBalance } = resolveAccountClassification(row.accountType)
    const parentId = row.parentNo ? idByAccountNo.get(row.parentNo) ?? null : null

    const { data, error } = await client
      .from('chart_of_accounts')
      .insert({
        company_id: companyId,
        account_no: row.accountNo,
        full_name: row.fullName,
        name: row.name,
        parent_no: row.parentNo,
        parent_id: parentId,
        account_type: row.accountType,
        sub_type: row.subType,
        canonical_type: canonicalType,
        normal_balance: normalBalance,
        is_active: true,
        balance: 0,
      })
      .select('id, account_no')
      .single()

    if (error) throw error
    idByAccountNo.set(row.accountNo, String(data.id))
    inserted++
  }

  return inserted
}
