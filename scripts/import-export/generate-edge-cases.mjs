#!/usr/bin/env node
/**
 * Generates edge-case fixtures for import/export framework testing.
 * Output: test-data/edge-cases/{module}/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCsv, writeXlsx } from './lib/writers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.join(ROOT, 'test-data', 'edge-cases')

const CUSTOMER_HEADERS = [
  'Name', 'Email', 'Phone', 'Address', 'City', 'Country',
  'Tax ID / VAT', 'Credit Limit', 'Payment Terms (days)', 'Active',
]

function edge(dir, name, headers, rows) {
  writeCsv(path.join(dir, `${name}.csv`), headers, rows)
  writeXlsx(path.join(dir, `${name}.xlsx`), headers, rows)
}

// --- customers edge cases ---
const customersDir = path.join(OUT, 'customers')

edge(customersDir, 'empty-file', CUSTOMER_HEADERS, [])

writeCsv(path.join(customersDir, 'missing-headers.csv'), [], [
  { col1: 'Al Rajhi Trading', col2: 'test@example.com' },
])

edge(customersDir, 'duplicate-headers', CUSTOMER_HEADERS, [
  {
    Name: 'Gulf Petrochemical Supplies',
    Email: 'info@gulfpetro.sa',
    Phone: '+966501234567',
    Address: 'King Saud Street',
    City: 'Dammam',
    Country: 'Saudi Arabia',
    'Tax ID / VAT': '310123456789003',
    'Credit Limit': '50000',
    'Payment Terms (days)': '30',
    Active: 'true',
  },
])
// duplicate-headers CSV needs manual header row
fs.writeFileSync(
  path.join(customersDir, 'duplicate-headers.csv'),
  'Name,Name,Email,Phone,Address,City,Country,Tax ID / VAT,Credit Limit,Payment Terms (days),Active\n' +
  'Gulf Petrochemical Supplies,Duplicate Name,info@gulfpetro.sa,+966501234567,King Saud Street,Dammam,Saudi Arabia,310123456789003,50000,30,true\n',
  'utf8',
)

edge(customersDir, 'wrong-data-types', CUSTOMER_HEADERS, [
  {
    Name: 'Riyadh Digital Solutions',
    Email: 'not-an-email',
    Phone: '12',
    Address: 'Tahlia Street',
    City: 'Riyadh',
    Country: 'Saudi Arabia',
    'Tax ID / VAT': 'INVALID-VAT',
    'Credit Limit': 'not-a-number',
    'Payment Terms (days)': 'thirty',
    Active: 'maybe',
  },
])

edge(customersDir, 'invalid-dates-employees-ref', CUSTOMER_HEADERS, [
  {
    Name: 'Valid Company Only',
    Email: 'valid@riyadh.sa',
    Phone: '+966501111111',
    Address: 'Olaya',
    City: 'Riyadh',
    Country: 'Saudi Arabia',
    'Tax ID / VAT': '310123456789003',
    'Credit Limit': '10000',
    'Payment Terms (days)': '30',
    Active: 'true',
  },
])

edge(customersDir, 'blank-required-fields', CUSTOMER_HEADERS, [
  {
    Name: '',
    Email: 'orphan@example.com',
    Phone: '+966502222222',
    Address: '',
    City: 'Jeddah',
    Country: 'Saudi Arabia',
    'Tax ID / VAT': '',
    'Credit Limit': '',
    'Payment Terms (days)': '',
    Active: 'true',
  },
  {
    Name: 'Lahore Textile Mills (Pvt) Ltd',
    Email: '',
    Phone: '',
    Address: 'Ferozepur Road',
    City: 'Lahore',
    Country: 'Pakistan',
    'Tax ID / VAT': '',
    'Credit Limit': '25000',
    'Payment Terms (days)': '45',
    Active: '',
  },
])

edge(customersDir, 'special-characters-arabic', CUSTOMER_HEADERS, [
  {
    Name: 'مؤسسة النخيل للتجارة & Co. "Special" <Test>',
    Email: 'مبيعات@نخيل.sa',
    Phone: '+966503333333',
    Address: 'طريق الملك عبدالعزيز — حي الملز، مبنى ٤٢',
    City: 'الرياض',
    Country: 'Saudi Arabia',
    'Tax ID / VAT': '310123456789003',
    'Credit Limit': '75000.50',
    'Payment Terms (days)': '30',
    Active: 'true',
  },
  {
    Name: 'Société Générale — München Ñoño',
    Email: 'contact+societe@example.co.uk',
    Phone: '+49-89-1234567',
    Address: 'Königstraße 1, 80331',
    City: 'München',
    Country: 'Germany',
    'Tax ID / VAT': '',
    'Credit Limit': '0',
    'Payment Terms (days)': '60',
    Active: 'yes',
  },
])

edge(customersDir, 'leading-trailing-spaces', CUSTOMER_HEADERS, [
  {
    Name: '  Dubai Marina Real Estate LLC  ',
    Email: '  finance@dubaimarina.ae  ',
    Phone: '  +971501234567  ',
    Address: '  Marina Walk  ',
    City: '  Dubai  ',
    Country: '  United Arab Emirates  ',
    'Tax ID / VAT': '  ',
    'Credit Limit': '  15000  ',
    'Payment Terms (days)': '  30  ',
    Active: '  true  ',
  },
])

edge(customersDir, 'mixed-case-headers-data', CUSTOMER_HEADERS, [
  {
    Name: 'Sharjah Industrial Equipment',
    Email: 'AR@SHARJAH.AE',
    Phone: '+971509876543',
    Address: 'Industrial Area 15',
    City: 'Sharjah',
    Country: 'United Arab Emirates',
    'Tax ID / VAT': '',
    'Credit Limit': '30000',
    'Payment Terms (days)': '30',
    Active: 'TRUE',
  },
])
fs.writeFileSync(
  path.join(customersDir, 'mixed-case-headers-data.csv'),
  'NAME,email,PHONE,address,CITY,country,Tax ID / VAT,CREDIT LIMIT,payment terms (days),ACTIVE\n' +
  'Sharjah Industrial Equipment,AR@SHARJAH.AE,+971509876543,Industrial Area 15,Sharjah,United Arab Emirates,,30000,30,TRUE\n',
  'utf8',
)

edge(customersDir, 'duplicate-records', CUSTOMER_HEADERS, [
  {
    Name: 'Karachi Port Services',
    Email: 'billing@karachiport.pk',
    Phone: '+923001234567',
    Address: 'M.A. Jinnah Road',
    City: 'Karachi',
    Country: 'Pakistan',
    'Tax ID / VAT': '',
    'Credit Limit': '40000',
    'Payment Terms (days)': '30',
    Active: 'true',
  },
  {
    Name: 'Karachi Port Services',
    Email: 'billing@karachiport.pk',
    Phone: '+923001234567',
    Address: 'M.A. Jinnah Road',
    City: 'Karachi',
    Country: 'Pakistan',
    'Tax ID / VAT': '',
    'Credit Limit': '40000',
    'Payment Terms (days)': '30',
    Active: 'true',
  },
])

// --- employees edge cases ---
const employeesDir = path.join(OUT, 'employees')
const EMP_HEADERS = [
  'Name', 'Email', 'Phone', 'Department', 'Position',
  'Joining Date', 'Salary', 'Salary Type', 'Bank Account', 'Active',
]

edge(employeesDir, 'invalid-dates', EMP_HEADERS, [
  {
    Name: 'Ahmed Al-Farsi',
    Email: 'ahmed@company.sa',
    Phone: '+966504444444',
    Department: 'Finance',
    Position: 'Accountant',
    'Joining Date': '31/02/2024',
    Salary: '12000',
    'Salary Type': 'MONTHLY',
    'Bank Account': 'SA0380000000608010167519',
    Active: 'true',
  },
  {
    Name: 'Fatima Al-Harbi',
    Email: 'fatima@company.sa',
    Phone: '+966505555555',
    Department: 'HR',
    Position: 'HR Manager',
    'Joining Date': 'not-a-date',
    Salary: '15000',
    'Salary Type': 'MONTHLY',
    'Bank Account': '',
    Active: 'true',
  },
])

edge(employeesDir, 'blank-required-joining-date', EMP_HEADERS, [
  {
    Name: 'Omar Hassan',
    Email: 'omar@company.sa',
    Phone: '+966506666666',
    Department: 'Sales',
    Position: 'Executive',
    'Joining Date': '',
    Salary: '8000',
    'Salary Type': 'MONTHLY',
    'Bank Account': '',
    Active: 'true',
  },
])

// --- inventory edge cases ---
const inventoryDir = path.join(OUT, 'inventory')
const INV_HEADERS = [
  'Name', 'Item Code', 'Description', 'Category', 'Unit',
  'Cost Price', 'Sale Price', 'Quantity', 'Min Quantity', 'Active',
]

edge(inventoryDir, 'negative-prices', INV_HEADERS, [
  {
    Name: 'Dell Latitude 5540 Laptop',
    'Item Code': 'SKU-NEG-001',
    Description: 'Test negative price',
    Category: 'Hardware',
    Unit: 'PCS',
    'Cost Price': '-1500',
    'Sale Price': '2000',
    Quantity: '10',
    'Min Quantity': '2',
    Active: 'true',
  },
])

// --- accounts edge cases ---
const accountsDir = path.join(OUT, 'accounts')
const ACC_HEADERS = [
  'Account No', 'Name', 'Full Name', 'Parent Account No',
  'Account Type', 'Sub Type', 'Description', 'Active',
]

edge(accountsDir, 'missing-required', ACC_HEADERS, [
  {
    'Account No': '',
    Name: '',
    'Full Name': '',
    'Parent Account No': '',
    'Account Type': '',
    'Sub Type': '',
    Description: '',
    Active: 'true',
  },
  {
    'Account No': '9999',
    Name: 'Valid Account',
    'Full Name': 'Valid Account',
    'Parent Account No': '',
    'Account Type': 'Expenses',
    'Sub Type': 'Office/General Administrative',
    Description: 'OK row',
    Active: 'true',
  },
])

// --- tax-rates edge cases ---
const taxDir = path.join(OUT, 'tax-rates')
const TAX_HEADERS = ['Name', 'Rate (%)', 'Type', 'Default', 'Active']

edge(taxDir, 'invalid-rates', TAX_HEADERS, [
  { Name: 'Bad Rate', 'Rate (%)': 'fifteen', Type: 'VAT', Default: 'false', Active: 'true' },
  { Name: 'Negative Rate', 'Rate (%)': '-5', Type: 'VAT', Default: 'false', Active: 'true' },
  { Name: 'Standard VAT (15%)', 'Rate (%)': '15', Type: 'VAT', Default: 'true', Active: 'true' },
])

console.log(`Edge-case fixtures written to ${OUT}`)
