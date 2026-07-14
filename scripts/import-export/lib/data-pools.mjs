/** Realistic business data pools for import/export test fixtures. */

export function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

/** Valid Saudi VAT TRN (15 digits). */
export function saudiVatTrn(rng, base = 310000000000000) {
  const suffix = Math.floor(rng() * 900) + 100
  const core = String(base + Math.floor(rng() * 999999)).slice(0, 12)
  return `${core}${suffix}`.padStart(15, '3').slice(0, 15)
}

export const SAUDI_COMPANIES = [
  { name: 'Al Rajhi Trading Establishment', city: 'Riyadh', country: 'Saudi Arabia', address: 'King Fahd Road, Olaya District' },
  { name: 'Saudi National Logistics Co.', city: 'Jeddah', country: 'Saudi Arabia', address: 'Prince Sultan Street, Al Rawdah' },
  { name: 'Gulf Petrochemical Supplies', city: 'Dammam', country: 'Saudi Arabia', address: 'King Saud Street, Al Faisaliyah' },
  { name: 'Riyadh Digital Solutions', city: 'Riyadh', country: 'Saudi Arabia', address: 'Tahlia Street, Al Mohammadiyah' },
  { name: 'Eastern Province Contracting', city: 'Khobar', country: 'Saudi Arabia', address: 'Corniche Road, Al Khobar' },
  { name: 'مؤسسة النخيل للتجارة', city: 'Riyadh', country: 'Saudi Arabia', address: 'طريق الملك عبدالعزيز، حي الملز' },
  { name: 'شركة الرياض للمقاولات', city: 'Riyadh', country: 'Saudi Arabia', address: 'حي النرجس، شارع أنس بن مالك' },
  { name: 'Makkah Hospitality Group', city: 'Makkah', country: 'Saudi Arabia', address: 'Ibrahim Al Khalil Street' },
  { name: 'Tabuk Agricultural Supplies', city: 'Tabuk', country: 'Saudi Arabia', address: 'Airport Road, Industrial Area' },
  { name: 'Jazan Fisheries Export', city: 'Jazan', country: 'Saudi Arabia', address: 'Corniche Boulevard' },
]

export const PAKISTAN_COMPANIES = [
  { name: 'Lahore Textile Mills (Pvt) Ltd', city: 'Lahore', country: 'Pakistan', address: 'Ferozepur Road, Gulberg III' },
  { name: 'Karachi Port Services', city: 'Karachi', country: 'Pakistan', address: 'M.A. Jinnah Road, Saddar' },
  { name: 'Islamabad IT Consultants', city: 'Islamabad', country: 'Pakistan', address: 'Blue Area, Jinnah Avenue' },
  { name: 'Faisalabad Agro Exports', city: 'Faisalabad', country: 'Pakistan', address: 'Sargodha Road, Madina Town' },
  { name: 'Rawalpindi Engineering Works', city: 'Rawalpindi', country: 'Pakistan', address: 'Murree Road, Satellite Town' },
]

export const UAE_COMPANIES = [
  { name: 'Dubai Marina Real Estate LLC', city: 'Dubai', country: 'United Arab Emirates', address: 'Marina Walk, Dubai Marina' },
  { name: 'Abu Dhabi Energy Trading', city: 'Abu Dhabi', country: 'United Arab Emirates', address: 'Khalifa Street, Al Markaziyah' },
  { name: 'Sharjah Industrial Equipment', city: 'Sharjah', country: 'United Arab Emirates', address: 'Industrial Area 15' },
  { name: 'Ajman Free Zone Trading', city: 'Ajman', country: 'United Arab Emirates', address: 'Sheikh Rashid Bin Humaid Street' },
  { name: 'RAK Ceramics Distribution', city: 'Ras Al Khaimah', country: 'United Arab Emirates', address: 'Al Nakheel Area' },
]

export const INVENTORY_ITEMS = [
  { name: 'Dell Latitude 5540 Laptop', category: 'Hardware', unit: 'PCS', type: 'product' },
  { name: 'HP LaserJet Pro M404dn', category: 'Hardware', unit: 'PCS', type: 'product' },
  { name: 'Cisco Catalyst 9200 Switch', category: 'Hardware', unit: 'PCS', type: 'product' },
  { name: 'Microsoft 365 Business Premium', category: 'Software', unit: 'LIC', type: 'service' },
  { name: 'Adobe Creative Cloud Team', category: 'Software', unit: 'LIC', type: 'service' },
  { name: 'Annual IT Support Contract', category: 'Services', unit: 'YR', type: 'service' },
  { name: 'Cloud Hosting — AWS EC2', category: 'Services', unit: 'MO', type: 'service' },
  { name: 'Office Ergonomic Chair', category: 'Furniture', unit: 'PCS', type: 'product' },
  { name: 'A4 Copy Paper (500 sheets)', category: 'Supplies', unit: 'RM', type: 'product' },
  { name: 'ZATCA E-Invoicing Integration', category: 'Services', unit: 'MO', type: 'service' },
  { name: 'Samsung 27" Monitor', category: 'Hardware', unit: 'PCS', type: 'product' },
  { name: 'Network Cabling — Cat6 per meter', category: 'Hardware', unit: 'M', type: 'product' },
]

export const COA_TEMPLATES = [
  { accountNo: '1000', name: 'Assets', fullName: 'Assets', parentNo: '', accountType: 'Other Assets', subType: 'Other Assets' },
  { accountNo: '1010', name: 'Cash on Hand', fullName: 'Assets:Cash on Hand', parentNo: '1000', accountType: 'Bank', subType: 'Cash on hand' },
  { accountNo: '1020', name: 'Main Operating Account', fullName: 'Assets:Main Operating Account', parentNo: '1000', accountType: 'Bank', subType: 'Checking' },
  { accountNo: '1200', name: 'Accounts Receivable', fullName: 'Assets:Accounts Receivable', parentNo: '1000', accountType: 'Accounts receivable (A/R)', subType: 'Accounts Receivable' },
  { accountNo: '1500', name: 'Inventory Asset', fullName: 'Assets:Inventory Asset', parentNo: '1000', accountType: 'Other Current Assets', subType: 'Inventory' },
  { accountNo: '2000', name: 'Liabilities', fullName: 'Liabilities', parentNo: '', accountType: 'Other Current Liabilities', subType: 'Other Current Liabilities' },
  { accountNo: '2100', name: 'Accounts Payable', fullName: 'Liabilities:Accounts Payable', parentNo: '2000', accountType: 'Accounts payable (A/P)', subType: 'Accounts Payable' },
  { accountNo: '2200', name: 'VAT Payable', fullName: 'Liabilities:VAT Payable', parentNo: '2000', accountType: 'Other Current Liabilities', subType: 'Sales Tax Payable' },
  { accountNo: '3000', name: 'Equity', fullName: 'Equity', parentNo: '', accountType: 'Equity', subType: 'Owner\'s Equity' },
  { accountNo: '3100', name: 'Retained Earnings', fullName: 'Equity:Retained Earnings', parentNo: '3000', accountType: 'Equity', subType: 'Retained Earnings' },
  { accountNo: '4000', name: 'Revenue', fullName: 'Revenue', parentNo: '', accountType: 'Income', subType: 'Sales of Product Income' },
  { accountNo: '4100', name: 'Consulting Revenue', fullName: 'Revenue:Consulting Revenue', parentNo: '4000', accountType: 'Income', subType: 'Service/Fee Income' },
  { accountNo: '5000', name: 'Cost of Goods Sold', fullName: 'Cost of Goods Sold', parentNo: '', accountType: 'Cost of Goods Sold', subType: 'Supplies & Materials' },
  { accountNo: '6000', name: 'Operating Expenses', fullName: 'Operating Expenses', parentNo: '', accountType: 'Expenses', subType: 'Office/General Administrative' },
  { accountNo: '6100', name: 'Rent Expense', fullName: 'Operating Expenses:Rent Expense', parentNo: '6000', accountType: 'Expenses', subType: 'Rent or Lease of Buildings' },
  { accountNo: '6200', name: 'Salaries & Wages', fullName: 'Operating Expenses:Salaries & Wages', parentNo: '6000', accountType: 'Expenses', subType: 'Payroll Expenses' },
  { accountNo: '6300', name: 'Utilities', fullName: 'Operating Expenses:Utilities', parentNo: '6000', accountType: 'Expenses', subType: 'Utilities' },
]

export const COST_CENTER_TEMPLATES = [
  { type: 'LOCATION', prefix: 'RYD', names: ['Riyadh Head Office', 'Riyadh Warehouse', 'Riyadh Showroom'] },
  { type: 'LOCATION', prefix: 'JED', names: ['Jeddah Branch', 'Jeddah Distribution Center'] },
  { type: 'LOCATION', prefix: 'DMM', names: ['Dammam Regional Office', 'Eastern Province Depot'] },
  { type: 'CLASS', prefix: 'CLS', names: ['Administration', 'Sales & Marketing', 'Finance & Accounting', 'Operations', 'Human Resources'] },
  { type: 'PROJECT', prefix: 'PRJ', names: ['ERP Implementation', 'ZATCA Phase 2 Rollout', 'Warehouse Expansion', 'Mobile App Development', 'Office Renovation 2026'] },
]

export const EMPLOYEE_NAMES = [
  { name: 'Ahmed Al-Farsi', department: 'Finance', position: 'Chief Accountant' },
  { name: 'Fatima Al-Harbi', department: 'Human Resources', position: 'HR Manager' },
  { name: 'Omar Hassan', department: 'Sales', position: 'Sales Executive' },
  { name: 'Sara Mahmoud', department: 'Operations', position: 'Operations Coordinator' },
  { name: 'Khalid Al-Otaibi', department: 'IT', position: 'Systems Administrator' },
  { name: 'Noura Al-Shehri', department: 'Marketing', position: 'Marketing Specialist' },
  { name: 'Muhammad Ali Khan', department: 'Procurement', position: 'Purchasing Officer' },
  { name: 'Layla Al-Qahtani', department: 'Finance', position: 'Accounts Payable Clerk' },
  { name: 'Youssef Ibrahim', department: 'Warehouse', position: 'Inventory Controller' },
  { name: 'Aisha Rahman', department: 'Customer Service', position: 'Support Lead' },
]

export const TAX_RATE_TEMPLATES = [
  { name: 'Standard VAT (15%)', rate: 15, type: 'VAT', isDefault: true },
  { name: 'Zero Rated (0%)', rate: 0, type: 'VAT', isDefault: false },
  { name: 'Exempt Supply', rate: 0, type: 'VAT', isDefault: false },
  { name: 'Withholding Tax (5%)', rate: 5, type: 'WITHHOLDING', isDefault: false },
  { name: 'GCC Reverse Charge (15%)', rate: 15, type: 'VAT', isDefault: false },
]

export function contactEmail(companyName, rng, index = 0) {
  const slug = companyName
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 20)
  const local = slug.length >= 3 ? slug : `billing${index + 1}`
  const domains = [
    'alrajhi.com.sa',
    'gulfpetro.com.sa',
    'riyadh-digital.sa',
    'lahoretextile.co.pk',
    'karachiport.pk',
    'dubaimarina.ae',
    'sharjahind.ae',
    'hisab.ai',
  ]
  return `${local}@${pick(rng, domains)}`
}

export function interleavePools(...pools) {
  const result = []
  const maxLen = Math.max(...pools.map((p) => p.length))
  for (let i = 0; i < maxLen; i += 1) {
    for (const pool of pools) {
      if (pool[i]) result.push(pool[i])
    }
  }
  return result
}

export function phoneForCountry(country, rng) {
  if (country === 'Saudi Arabia') return `+9665${String(Math.floor(rng() * 90000000) + 10000000)}`
  if (country === 'Pakistan') return `+92${300 + Math.floor(rng() * 10)}${String(Math.floor(rng() * 9000000) + 1000000)}`
  if (country === 'United Arab Emirates') return `+9715${String(Math.floor(rng() * 90000000) + 10000000)}`
  return `+9665${String(Math.floor(rng() * 90000000) + 10000000)}`
}
