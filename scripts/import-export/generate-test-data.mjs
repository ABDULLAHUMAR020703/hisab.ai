#!/usr/bin/env node
/**
 * Generates realistic import/export test datasets for all migrated modules.
 * Output: test-data/{module}/{small|medium|large}.{csv|xlsx}
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COA_TEMPLATES,
  COST_CENTER_TEMPLATES,
  EMPLOYEE_NAMES,
  INVENTORY_ITEMS,
  PAKISTAN_COMPANIES,
  SAUDI_COMPANIES,
  TAX_RATE_TEMPLATES,
  UAE_COMPANIES,
  interleavePools,
  contactEmail,
  phoneForCountry,
  pick,
  saudiVatTrn,
  seededRandom,
} from './lib/data-pools.mjs'
import { writeDataset } from './lib/writers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.join(ROOT, 'test-data')

const SIZES = { small: 10, medium: 100, large: 1000 }

const CUSTOMER_HEADERS = [
  'Name', 'Email', 'Phone', 'Address', 'City', 'Country',
  'Tax ID / VAT', 'Credit Limit', 'Payment Terms (days)', 'Active',
]

const VENDOR_HEADERS = [
  'Name', 'Email', 'Phone', 'Address', 'City', 'Country',
  'Tax ID / VAT', 'Payment Terms (days)', 'Active',
]

const INVENTORY_HEADERS = [
  'Name', 'Item Code', 'Description', 'Category', 'Unit',
  'Cost Price', 'Sale Price', 'Quantity', 'Min Quantity', 'Active',
]

const ACCOUNT_HEADERS = [
  'Account No', 'Name', 'Full Name', 'Parent Account No',
  'Account Type', 'Sub Type', 'Description', 'Active',
]

const COST_CENTER_HEADERS = ['Code', 'Name', 'Type', 'Description', 'Active']

const EMPLOYEE_HEADERS = [
  'Name', 'Email', 'Phone', 'Department', 'Position',
  'Joining Date', 'Salary', 'Salary Type', 'Bank Account', 'Active',
]

const TAX_RATE_HEADERS = ['Name', 'Rate (%)', 'Type', 'Default', 'Active']

function generateContacts(count, rng, includeCreditLimit = false) {
  const pool = interleavePools(SAUDI_COMPANIES, PAKISTAN_COMPANIES, UAE_COMPANIES)
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const base = { ...pool[i % pool.length] }
    const suffix = i >= pool.length ? ` — Branch ${Math.floor(i / pool.length) + 1}` : ''
    const name = `${base.name}${suffix}`
    const row = {
      Name: name,
      Email: contactEmail(name, rng, i),
      Phone: phoneForCountry(base.country, rng),
      Address: base.address,
      City: base.city,
      Country: base.country,
      'Tax ID / VAT': base.country === 'Saudi Arabia' ? saudiVatTrn(rng, 310000000000000 + i) : '',
      'Payment Terms (days)': pick(rng, [15, 30, 45, 60]),
      Active: pick(rng, ['true', 'false', 'yes', 'active']),
    }
    if (includeCreditLimit) {
      row['Credit Limit'] = Math.round((rng() * 500000 + 10000) * 100) / 100
    }
    rows.push(row)
  }
  return rows
}

function generateInventory(count, rng) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const item = { ...INVENTORY_ITEMS[i % INVENTORY_ITEMS.length] }
    const variant = i >= INVENTORY_ITEMS.length ? ` — Variant ${Math.floor(i / INVENTORY_ITEMS.length) + 1}` : ''
    const cost = Math.round((rng() * 5000 + 50) * 100) / 100
    const margin = 1.15 + rng() * 0.35
    rows.push({
      Name: `${item.name}${variant}`,
      'Item Code': `SKU-${String(10000 + i).padStart(5, '0')}`,
      Description: `${item.type === 'service' ? 'Professional' : 'Commercial'} ${item.category.toLowerCase()} offering`,
      Category: item.category,
      Unit: item.unit,
      'Cost Price': cost,
      'Sale Price': Math.round(cost * margin * 100) / 100,
      Quantity: Math.floor(rng() * 500),
      'Min Quantity': Math.floor(rng() * 20) + 5,
      Active: 'true',
    })
  }
  return rows
}

function generateAccounts(count, rng) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    if (i < COA_TEMPLATES.length) {
      const t = COA_TEMPLATES[i]
      rows.push({
        'Account No': t.accountNo,
        Name: t.name,
        'Full Name': t.fullName,
        'Parent Account No': t.parentNo,
        'Account Type': t.accountType,
        'Sub Type': t.subType,
        Description: `Standard ${t.accountType} account`,
        Active: 'true',
      })
    } else {
      const parent = COA_TEMPLATES[Math.floor(rng() * COA_TEMPLATES.length)]
      const subNo = `${parent.accountNo}-${String(i).padStart(3, '0')}`
      rows.push({
        'Account No': subNo,
        Name: `${parent.name} — Sub ${i}`,
        'Full Name': `${parent.fullName}:Sub ${i}`,
        'Parent Account No': parent.accountNo,
        'Account Type': parent.accountType,
        'Sub Type': parent.subType,
        Description: `Detail account under ${parent.name}`,
        Active: pick(rng, ['true', 'true', 'false']),
      })
    }
  }
  return rows
}

function generateCostCenters(count, rng) {
  // Interleave types so small datasets include LOCATION, CLASS, and PROJECT
  const byType = { LOCATION: [], CLASS: [], PROJECT: [] }
  for (const template of COST_CENTER_TEMPLATES) {
    for (const name of template.names) {
      byType[template.type].push({ template, name })
    }
  }
  const interleaved = []
  const maxPerType = Math.max(byType.LOCATION.length, byType.CLASS.length, byType.PROJECT.length)
  for (let i = 0; i < maxPerType; i += 1) {
    for (const type of ['LOCATION', 'CLASS', 'PROJECT']) {
      if (byType[type][i]) interleaved.push(byType[type][i])
    }
  }

  const rows = []
  for (let idx = 0; idx < count; idx += 1) {
    if (idx < interleaved.length) {
      const { template, name } = interleaved[idx]
      rows.push({
        Code: `${template.prefix}-${String(idx + 1).padStart(3, '0')}`,
        Name: name,
        Type: template.type,
        Description: `${template.type === 'LOCATION' ? 'Geographic' : template.type === 'CLASS' ? 'Functional' : 'Project'} cost tracking`,
        Active: 'true',
      })
    } else {
      const t = pick(rng, COST_CENTER_TEMPLATES)
      rows.push({
        Code: `${t.prefix}-X${String(idx + 1).padStart(3, '0')}`,
        Name: `${pick(rng, t.names)} Extension ${idx + 1}`,
        Type: t.type,
        Description: `Additional ${t.type.toLowerCase()} center`,
        Active: 'true',
      })
    }
  }
  return rows
}

function generateEmployees(count, rng) {
  const rows = []
  const depts = ['Finance', 'Sales', 'Operations', 'IT', 'HR', 'Procurement', 'Marketing', 'Warehouse']
  const positions = ['Manager', 'Senior Analyst', 'Coordinator', 'Specialist', 'Officer', 'Lead', 'Executive']
  for (let i = 0; i < count; i += 1) {
    const base = EMPLOYEE_NAMES[i % EMPLOYEE_NAMES.length]
    const suffix = i >= EMPLOYEE_NAMES.length ? ` ${i + 1}` : ''
    const joinYear = 2018 + Math.floor(rng() * 8)
    const joinMonth = String(Math.floor(rng() * 12) + 1).padStart(2, '0')
    const joinDay = String(Math.floor(rng() * 28) + 1).padStart(2, '0')
    rows.push({
      Name: `${base.name}${suffix}`,
      Email: contactEmail(base.name.replace(/\s/g, ''), rng, i),
      Phone: phoneForCountry(pick(rng, ['Saudi Arabia', 'Pakistan', 'United Arab Emirates']), rng),
      Department: base.department || pick(rng, depts),
      Position: base.position || `${pick(rng, positions)}`,
      'Joining Date': `${joinYear}-${joinMonth}-${joinDay}`,
      Salary: Math.round((rng() * 25000 + 5000) * 100) / 100,
      'Salary Type': pick(rng, ['MONTHLY', 'HOURLY']),
      'Bank Account': `SA${String(10 + Math.floor(rng() * 89)).padStart(2, '0')}${String(Math.floor(rng() * 1e20)).padStart(20, '0')}`.slice(0, 24),
      Active: 'true',
    })
  }
  return rows
}

function generateTaxRates(count, rng) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    if (i < TAX_RATE_TEMPLATES.length) {
      const t = TAX_RATE_TEMPLATES[i]
      rows.push({
        Name: t.name,
        'Rate (%)': t.rate,
        Type: t.type,
        Default: t.isDefault ? 'true' : 'false',
        Active: 'true',
      })
    } else {
      rows.push({
        Name: `Regional Tax — Zone ${i + 1}`,
        'Rate (%)': Math.round(rng() * 20 * 100) / 100,
        Type: pick(rng, ['VAT', 'WITHHOLDING', 'ZATCA']),
        Default: 'false',
        Active: pick(rng, ['true', 'false']),
      })
    }
  }
  return rows
}

const MODULES = [
  { key: 'customers', headers: CUSTOMER_HEADERS, generate: (n, rng) => generateContacts(n, rng, true) },
  { key: 'vendors', headers: VENDOR_HEADERS, generate: (n, rng) => generateContacts(n, rng, false) },
  { key: 'inventory', headers: INVENTORY_HEADERS, generate: generateInventory },
  { key: 'accounts', headers: ACCOUNT_HEADERS, generate: generateAccounts },
  { key: 'cost-centers', headers: COST_CENTER_HEADERS, generate: generateCostCenters },
  { key: 'employees', headers: EMPLOYEE_HEADERS, generate: generateEmployees },
  { key: 'tax-rates', headers: TAX_RATE_HEADERS, generate: generateTaxRates },
]

console.log('Generating import/export test data...\n')

for (const mod of MODULES) {
  const dir = path.join(OUT, mod.key)
  for (const [sizeName, count] of Object.entries(SIZES)) {
    const rng = seededRandom(mod.key.length * 1000 + count)
    const rows = mod.generate(count, rng)
    writeDataset(dir, sizeName, mod.headers, rows)
    console.log(`  ${mod.key}/${sizeName}: ${count} rows (CSV + XLSX)`)
  }
}

console.log(`\nDone. Output: ${OUT}`)
