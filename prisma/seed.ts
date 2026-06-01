import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getSqliteDatabaseUrl } from '../src/lib/sqlite-db'
import { ensureDemoUsers } from '../src/lib/demo-users'

const adapter = new PrismaBetterSqlite3({ url: getSqliteDatabaseUrl() })
const prisma = new PrismaClient({ adapter })

const COA_ACCOUNTS = [
  // ASSETS
  { accountNo: '10', name: 'ASSETS', fullName: 'Assets', parentNo: null, accountType: 'Asset', subType: 'Header' },
  { accountNo: '11', name: 'CURRENT ASSETS', fullName: 'Current Assets', parentNo: '10', accountType: 'Asset', subType: 'Header' },
  { accountNo: '1101', name: 'CASH AND BANK', fullName: 'Cash and Bank', parentNo: '11', accountType: 'Asset', subType: 'Bank' },
  { accountNo: '110101', name: 'CASH IN HAND', fullName: 'Cash In Hand', parentNo: '1101', accountType: 'Asset', subType: 'Cash' },
  { accountNo: '110102', name: 'PETTY CASH', fullName: 'Petty Cash', parentNo: '1101', accountType: 'Asset', subType: 'Cash' },
  { accountNo: '110103', name: 'BANK - AL RAJHI', fullName: 'Bank - Al Rajhi', parentNo: '1101', accountType: 'Asset', subType: 'Bank' },
  { accountNo: '110104', name: 'BANK - RIYADH BANK', fullName: 'Bank - Riyadh Bank', parentNo: '1101', accountType: 'Asset', subType: 'Bank' },
  { accountNo: '110105', name: 'BANK - NCB', fullName: 'Bank - NCB', parentNo: '1101', accountType: 'Asset', subType: 'Bank' },
  { accountNo: '1102', name: 'ACCOUNTS RECEIVABLE', fullName: 'Accounts Receivable', parentNo: '11', accountType: 'Asset', subType: 'AccountsReceivable' },
  { accountNo: '110201', name: 'TRADE DEBTORS', fullName: 'Trade Debtors', parentNo: '1102', accountType: 'Asset', subType: 'AccountsReceivable' },
  { accountNo: '110202', name: 'NOTES RECEIVABLE', fullName: 'Notes Receivable', parentNo: '1102', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '1103', name: 'PREPAYMENTS & ADVANCES', fullName: 'Prepayments and Advances', parentNo: '11', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '110301', name: 'PREPAID EXPENSES', fullName: 'Prepaid Expenses', parentNo: '1103', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '110302', name: 'ADVANCE TO SUPPLIERS', fullName: 'Advance to Suppliers', parentNo: '1103', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '110303', name: 'EMPLOYEE ADVANCES', fullName: 'Employee Advances', parentNo: '1103', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '1104', name: 'INVENTORY', fullName: 'Inventory', parentNo: '11', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '110401', name: 'GOODS INVENTORY', fullName: 'Goods Inventory', parentNo: '1104', accountType: 'Asset', subType: 'OtherCurrentAsset' },
  { accountNo: '12', name: 'FIXED ASSETS', fullName: 'Fixed Assets', parentNo: '10', accountType: 'Asset', subType: 'Header' },
  { accountNo: '1201', name: 'PROPERTY & EQUIPMENT', fullName: 'Property and Equipment', parentNo: '12', accountType: 'Asset', subType: 'FixedAsset' },
  { accountNo: '120101', name: 'FURNITURE & FIXTURES', fullName: 'Furniture and Fixtures', parentNo: '1201', accountType: 'Asset', subType: 'FixedAsset' },
  { accountNo: '120102', name: 'COMPUTER EQUIPMENT', fullName: 'Computer Equipment', parentNo: '1201', accountType: 'Asset', subType: 'FixedAsset' },
  { accountNo: '120103', name: 'VEHICLES', fullName: 'Vehicles', parentNo: '1201', accountType: 'Asset', subType: 'FixedAsset' },
  { accountNo: '120104', name: 'OFFICE EQUIPMENT', fullName: 'Office Equipment', parentNo: '1201', accountType: 'Asset', subType: 'FixedAsset' },
  { accountNo: '1202', name: 'ACCUMULATED DEPRECIATION', fullName: 'Accumulated Depreciation', parentNo: '12', accountType: 'Asset', subType: 'FixedAsset' },

  // LIABILITIES
  { accountNo: '20', name: 'LIABILITIES', fullName: 'Liabilities', parentNo: null, accountType: 'Liability', subType: 'Header' },
  { accountNo: '21', name: 'CURRENT LIABILITIES', fullName: 'Current Liabilities', parentNo: '20', accountType: 'Liability', subType: 'Header' },
  { accountNo: '2101', name: 'ACCOUNTS PAYABLE', fullName: 'Accounts Payable', parentNo: '21', accountType: 'Liability', subType: 'AccountsPayable' },
  { accountNo: '210101', name: 'TRADE CREDITORS', fullName: 'Trade Creditors', parentNo: '2101', accountType: 'Liability', subType: 'AccountsPayable' },
  { accountNo: '2102', name: 'VAT PAYABLE', fullName: 'VAT Payable', parentNo: '21', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '210201', name: 'VAT OUTPUT', fullName: 'VAT Output (Sales)', parentNo: '2102', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '210202', name: 'VAT INPUT', fullName: 'VAT Input (Purchases)', parentNo: '2102', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '2103', name: 'ACCRUED LIABILITIES', fullName: 'Accrued Liabilities', parentNo: '21', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '210301', name: 'ACCRUED SALARIES', fullName: 'Accrued Salaries', parentNo: '2103', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '210302', name: 'ACCRUED EXPENSES', fullName: 'Accrued Expenses', parentNo: '2103', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '2104', name: 'EMPLOYEE BENEFITS', fullName: 'Employee Benefits Payable', parentNo: '21', accountType: 'Liability', subType: 'OtherCurrentLiability' },
  { accountNo: '22', name: 'LONG-TERM LIABILITIES', fullName: 'Long-term Liabilities', parentNo: '20', accountType: 'Liability', subType: 'Header' },
  { accountNo: '2201', name: 'LOANS PAYABLE', fullName: 'Loans Payable', parentNo: '22', accountType: 'Liability', subType: 'LongTermLiability' },
  { accountNo: '220101', name: 'BANK LOANS', fullName: 'Bank Loans', parentNo: '2201', accountType: 'Liability', subType: 'LongTermLiability' },

  // EQUITY
  { accountNo: '30', name: 'EQUITY', fullName: 'Equity', parentNo: null, accountType: 'Equity', subType: 'Header' },
  { accountNo: '3001', name: 'SHARE CAPITAL', fullName: 'Share Capital', parentNo: '30', accountType: 'Equity', subType: 'Equity' },
  { accountNo: '3002', name: 'RETAINED EARNINGS', fullName: 'Retained Earnings', parentNo: '30', accountType: 'Equity', subType: 'RetainedEarnings' },
  { accountNo: '3003', name: 'CURRENT YEAR PROFIT', fullName: 'Current Year Profit/Loss', parentNo: '30', accountType: 'Equity', subType: 'RetainedEarnings' },

  // INCOME
  { accountNo: '40', name: 'INCOME', fullName: 'Income', parentNo: null, accountType: 'Income', subType: 'Header' },
  { accountNo: '4001', name: 'SALES REVENUE', fullName: 'Sales Revenue', parentNo: '40', accountType: 'Income', subType: 'Income' },
  { accountNo: '400101', name: 'SERVICES REVENUE', fullName: 'Services Revenue', parentNo: '4001', accountType: 'Income', subType: 'Income' },
  { accountNo: '400102', name: 'PRODUCT SALES', fullName: 'Product Sales', parentNo: '4001', accountType: 'Income', subType: 'Income' },
  { accountNo: '400103', name: 'TELECOM SERVICES', fullName: 'Telecom Services Revenue', parentNo: '4001', accountType: 'Income', subType: 'Income' },
  { accountNo: '4002', name: 'OTHER INCOME', fullName: 'Other Income', parentNo: '40', accountType: 'Income', subType: 'OtherIncome' },
  { accountNo: '400201', name: 'INTEREST INCOME', fullName: 'Interest Income', parentNo: '4002', accountType: 'Income', subType: 'OtherIncome' },
  { accountNo: '400202', name: 'MISCELLANEOUS INCOME', fullName: 'Miscellaneous Income', parentNo: '4002', accountType: 'Income', subType: 'OtherIncome' },

  // COST OF GOODS SOLD
  { accountNo: '50', name: 'COST OF SALES', fullName: 'Cost of Sales', parentNo: null, accountType: 'CostOfGoodsSold', subType: 'Header' },
  { accountNo: '5001', name: 'DIRECT COSTS', fullName: 'Direct Costs', parentNo: '50', accountType: 'CostOfGoodsSold', subType: 'CostOfGoodsSold' },
  { accountNo: '500101', name: 'COST OF SERVICES', fullName: 'Cost of Services', parentNo: '5001', accountType: 'CostOfGoodsSold', subType: 'CostOfGoodsSold' },
  { accountNo: '500102', name: 'COST OF GOODS SOLD', fullName: 'Cost of Goods Sold', parentNo: '5001', accountType: 'CostOfGoodsSold', subType: 'CostOfGoodsSold' },
  { accountNo: '500103', name: 'DIRECT LABOR', fullName: 'Direct Labor', parentNo: '5001', accountType: 'CostOfGoodsSold', subType: 'CostOfGoodsSold' },

  // EXPENSES
  { accountNo: '60', name: 'OPERATING EXPENSES', fullName: 'Operating Expenses', parentNo: null, accountType: 'Expense', subType: 'Header' },
  { accountNo: '6001', name: 'SALARIES & WAGES', fullName: 'Salaries and Wages', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600101', name: 'BASIC SALARIES', fullName: 'Basic Salaries', parentNo: '6001', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600102', name: 'ALLOWANCES', fullName: 'Allowances', parentNo: '6001', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600103', name: 'OVERTIME', fullName: 'Overtime', parentNo: '6001', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600104', name: 'GOSI - EMPLOYER', fullName: 'GOSI - Employer Contribution', parentNo: '6001', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '6002', name: 'RENT EXPENSES', fullName: 'Rent Expenses', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600201', name: 'OFFICE RENT', fullName: 'Office Rent', parentNo: '6002', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600202', name: 'WAREHOUSE RENT', fullName: 'Warehouse Rent', parentNo: '6002', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '6003', name: 'UTILITIES', fullName: 'Utilities', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600301', name: 'ELECTRICITY', fullName: 'Electricity', parentNo: '6003', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600302', name: 'WATER', fullName: 'Water', parentNo: '6003', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600303', name: 'INTERNET & TELECOM', fullName: 'Internet and Telecom', parentNo: '6003', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '6004', name: 'GENERAL & ADMIN', fullName: 'General and Administrative', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600401', name: 'OFFICE SUPPLIES', fullName: 'Office Supplies', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600402', name: 'PRINTING & STATIONERY', fullName: 'Printing and Stationery', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600403', name: 'TRAVEL & TRANSPORT', fullName: 'Travel and Transport', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600404', name: 'MEALS & ENTERTAINMENT', fullName: 'Meals and Entertainment', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600405', name: 'INSURANCE', fullName: 'Insurance', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600406', name: 'LEGAL & PROFESSIONAL', fullName: 'Legal and Professional Fees', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600407', name: 'REPAIRS & MAINTENANCE', fullName: 'Repairs and Maintenance', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600408', name: 'DEPRECIATION', fullName: 'Depreciation Expense', parentNo: '6004', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '6005', name: 'MARKETING & SALES', fullName: 'Marketing and Sales', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600501', name: 'ADVERTISING', fullName: 'Advertising', parentNo: '6005', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600502', name: 'PROMOTIONS', fullName: 'Promotions', parentNo: '6005', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '6006', name: 'FINANCE COSTS', fullName: 'Finance Costs', parentNo: '60', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600601', name: 'BANK CHARGES', fullName: 'Bank Charges', parentNo: '6006', accountType: 'Expense', subType: 'Expense' },
  { accountNo: '600602', name: 'INTEREST EXPENSE', fullName: 'Interest Expense', parentNo: '6006', accountType: 'Expense', subType: 'Expense' },
]

async function main() {
  console.log('Seeding database...')

  // Company settings
  const existingSettings = await prisma.companySettings.findFirst()
  if (!existingSettings) {
    await prisma.companySettings.create({
      data: {
        companyName: 'NETKOM COMPANY FOR COMMUNICATION',
        legalName: 'NETKOM COMPANY FOR COMMUNICATION LLC',
        country: 'Saudi Arabia',
        currency: 'SAR',
        fiscalYearStart: '01-01',
        zatcaEnabled: false,
      },
    })
    console.log('Created company settings')
  }

  await ensureDemoUsers(prisma)

  // COA accounts
  let coaCreated = 0
  for (const account of COA_ACCOUNTS) {
    const existing = await prisma.chartOfAccount.findUnique({ where: { accountNo: account.accountNo } })
    if (!existing) {
      await prisma.chartOfAccount.create({ data: account })
      coaCreated++
    }
  }
  console.log(`Created ${coaCreated} COA accounts`)

  // Tax rates
  const existingVAT = await prisma.taxRate.findFirst({ where: { name: 'VAT 15%' } })
  if (!existingVAT) {
    await prisma.taxRate.createMany({
      data: [
        { name: 'VAT 15%', rate: 15, type: 'VAT', isDefault: true, isActive: true },
        { name: 'VAT 5%', rate: 5, type: 'VAT', isDefault: false, isActive: true },
        { name: 'Zero Rated', rate: 0, type: 'VAT', isDefault: false, isActive: true },
        { name: 'Exempt', rate: 0, type: 'EXEMPT', isDefault: false, isActive: true },
      ],
    })
    console.log('Created tax rates')
  }

  // Sequences
  const sequences = [
    { type: 'JOURNAL', prefix: 'JV-' },
    { type: 'INVOICE', prefix: 'INV-' },
    { type: 'BILL', prefix: 'BILL-' },
    { type: 'EXPENSE', prefix: 'EXP-' },
    { type: 'PAYMENT', prefix: 'PAY-' },
    { type: 'EMPLOYEE', prefix: 'EMP-' },
    { type: 'PAYROLL', prefix: 'PRL-' },
    { type: 'CUSTOMER', prefix: 'CUST-' },
    { type: 'VENDOR', prefix: 'VEND-' },
    { type: 'ITEM', prefix: 'ITEM-' },
    { type: 'CC', prefix: 'CC-' },
  ]

  for (const seq of sequences) {
    const existing = await prisma.sequence.findUnique({ where: { type: seq.type } })
    if (!existing) {
      await prisma.sequence.create({ data: { ...seq, nextNo: 1 } })
    }
  }
  console.log('Created sequences')

  // Cost Centers
  const costCenters = [
    { code: 'CC-RYD', name: 'Riyadh Office', type: 'BRANCH', description: 'Riyadh Head Office' },
    { code: 'CC-DMM', name: 'Dammam Office', type: 'BRANCH', description: 'Dammam Branch Office' },
    { code: 'CC-PRJ', name: 'General Projects', type: 'PROJECT', description: 'General project cost center' },
    { code: 'CC-ADM', name: 'Administration', type: 'DEPARTMENT', description: 'Administrative department' },
    { code: 'CC-OPS', name: 'Operations', type: 'DEPARTMENT', description: 'Operations department' },
  ]

  let ccCreated = 0
  for (const cc of costCenters) {
    const existing = await prisma.costCenter.findUnique({ where: { code: cc.code } })
    if (!existing) {
      await prisma.costCenter.create({ data: cc })
      ccCreated++
    }
  }
  console.log(`Created ${ccCreated} cost centers`)

  // Demo transactions (customers, invoices, bills, etc.)
  const { seedDemoTransactions } = await import('../src/lib/demo-seed')
  const demoResult = await seedDemoTransactions()
  if (demoResult === 'created') console.log('Created demo transactions')
  else if (demoResult !== 'skipped') console.log(`Demo data: ${demoResult}`)

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
