/**
 * QA test data generator for hisab.ai
 * Run: npm run qa:seed
 * Reset: npm run qa:seed -- --force
 */
import { randomUUID } from 'crypto'
import type { InvoiceType, PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getSqliteDatabaseUrl } from './sqlite-db'

const QA_MARKER = 'QA-SEED-v1'

const SAUDI_FIRST_NAMES = ['Ahmed', 'Mohammed', 'Fatima', 'Sara', 'Khalid', 'Noura', 'Omar', 'Layla', 'Faisal', 'Huda']
const SAUDI_LAST_NAMES = ['Al-Rashid', 'Al-Qahtani', 'Al-Otaibi', 'Al-Harbi', 'Al-Dosari', 'Al-Ghamdi', 'Al-Zahrani', 'Al-Mutairi']
const BUSINESS_SUFFIXES = ['Trading Co.', 'Contracting LLC', 'Services EST', 'Group', 'Holdings', 'Industries', 'Solutions']

const CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Makkah', 'Madinah', 'Tabuk', 'Abha']
const DISTRICTS = ['Al Olaya', 'Al Malaz', 'Al Rawdah', 'Al Nakheel', 'Al Sulaimaniyah', 'Al Muruj']

const PRODUCT_CATEGORIES = [
  { category: 'Hardware', unit: 'PCS', costRange: [50, 5000] },
  { category: 'Software', unit: 'LIC', costRange: [200, 15000] },
  { category: 'Services', unit: 'HRS', costRange: [100, 800] },
  { category: 'Materials', unit: 'KG', costRange: [5, 200] },
  { category: 'Electronics', unit: 'PCS', costRange: [80, 12000] },
  { category: 'Office', unit: 'BOX', costRange: [20, 500] },
  { category: 'Consumables', unit: 'PCS', costRange: [2, 150] },
  { category: 'Furniture', unit: 'PCS', costRange: [300, 8000] },
]

const VAT_RATES = [0, 5, 15]

export interface QaSeedResult {
  status: 'created' | 'skipped' | 'reset'
  customers: number
  inventory: number
  invoices: number
  vendors: number
  message: string
}

function createPrisma(): PrismaClient {
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
  const adapter = new PrismaBetterSqlite3({ url: getSqliteDatabaseUrl() })
  return new PrismaClient({ adapter })
}

function formatIssueTime(date: Date): string {
  return date.toTimeString().split(' ')[0]
}

async function getNextSequence(prisma: PrismaClient, type: string, prefix: string): Promise<string> {
  let seq = await prisma.sequence.findUnique({ where: { type } })
  if (!seq) {
    seq = await prisma.sequence.create({ data: { type, prefix, nextNo: 1 } })
  }
  const no = seq.nextNo
  await prisma.sequence.update({ where: { type }, data: { nextNo: no + 1 } })
  return `${prefix}${String(no).padStart(5, '0')}`
}

function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function generateVatTrn(seed: number, withVat: boolean): string | null {
  if (!withVat) return null
  const base = String(300000000000000 + seed).slice(0, 14)
  return `${base}3`
}

async function clearQaData(prisma: PrismaClient) {
  await prisma.payment.deleteMany({ where: { notes: QA_MARKER } })
  await prisma.invoiceLine.deleteMany({ where: { description: { contains: QA_MARKER } } })
  await prisma.invoice.deleteMany({ where: { notes: { contains: QA_MARKER } } })
  await prisma.inventoryItem.deleteMany({ where: { description: { contains: QA_MARKER } } })
  await prisma.customer.deleteMany({ where: { email: { contains: '@qa.hisab.ai' } } })
  await prisma.vendor.deleteMany({ where: { email: { contains: '@qa.hisab.ai' } } })
}

export async function seedQaData(options: { force?: boolean; prisma?: PrismaClient } = {}): Promise<QaSeedResult> {
  const ownsClient = !options.prisma
  const prisma = options.prisma ?? createPrisma()
  const force = options.force ?? false

  try {
    const existing = await prisma.customer.findFirst({ where: { email: { contains: '@qa.hisab.ai' } } })
    if (existing && !force) {
      const counts = await Promise.all([
        prisma.customer.count({ where: { email: { contains: '@qa.hisab.ai' } } }),
        prisma.inventoryItem.count({ where: { description: { contains: QA_MARKER } } }),
        prisma.invoice.count({ where: { notes: { contains: QA_MARKER } } }),
        prisma.vendor.count({ where: { email: { contains: '@qa.hisab.ai' } } }),
      ])
      return {
        status: 'skipped',
        customers: counts[0],
        inventory: counts[1],
        invoices: counts[2],
        vendors: counts[3],
        message: 'QA data already exists. Run with --force to reset and re-seed.',
      }
    }

    if (force) {
      await clearQaData(prisma)
    }

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    if (!admin) {
      return { status: 'skipped', customers: 0, inventory: 0, invoices: 0, vendors: 0, message: 'No admin user. Run npm run db:seed first.' }
    }

    const revenueAcct = await prisma.chartOfAccount.findFirst({ where: { accountNo: '400101' } })
    const costCenter = await prisma.costCenter.findFirst()

    // --- 10 vendors ---
    const vendors = []
    for (let i = 0; i < 10; i++) {
      const v = await prisma.vendor.create({
        data: {
          vendorNo: await getNextSequence(prisma, 'VENDOR', 'VEND-'),
          name: `${pick(BUSINESS_SUFFIXES, i)} Vendor ${i + 1}`,
          email: `vendor${i + 1}@qa.hisab.ai`,
          phone: `+966 11 ${String(1000000 + i).slice(-7)}`,
          city: pick(CITIES, i),
          country: 'Saudi Arabia',
          taxId: generateVatTrn(1000 + i, i % 2 === 0),
          paymentTerms: [15, 30, 45, 60][i % 4],
        },
      })
      vendors.push(v)
    }

    // --- 50 customers (30 business VAT, 10 business non-VAT, 10 individual) ---
    const customers = []
    for (let i = 0; i < 50; i++) {
      const isIndividual = i >= 40
      const hasVat = i < 30 || (i >= 40 && i % 2 === 0)
      const first = pick(SAUDI_FIRST_NAMES, i)
      const last = pick(SAUDI_LAST_NAMES, i)
      const name = isIndividual
        ? `${first} ${last}`
        : `${first} ${last} ${pick(BUSINESS_SUFFIXES, i)}`

      const c = await prisma.customer.create({
        data: {
          customerNo: await getNextSequence(prisma, 'CUSTOMER', 'CUST-'),
          name,
          email: `customer${i + 1}@qa.hisab.ai`,
          phone: `+966 5${String(50000000 + i).slice(-8)}`,
          streetAddress: `${1000 + i} ${pick(DISTRICTS, i)} Street`,
          buildingNumber: String(1000 + (i % 9000)),
          district: pick(DISTRICTS, i),
          city: pick(CITIES, i),
          country: 'Saudi Arabia',
          postalCode: String(10000 + (i % 89999)),
          taxId: generateVatTrn(2000 + i, hasVat),
          creditLimit: isIndividual ? 50000 : 500000,
          paymentTerms: [15, 30, 45, 60][i % 4],
        },
      })
      customers.push(c)
    }

    // --- 100 inventory items (products) ---
    for (let i = 0; i < 100; i++) {
      const cat = pick(PRODUCT_CATEGORIES, i)
      const cost = round2(cat.costRange[0] + (i % 10) * ((cat.costRange[1] - cat.costRange[0]) / 10))
      const markup = 1 + (i % 5) * 0.1
      await prisma.inventoryItem.create({
        data: {
          itemCode: `QA-ITEM-${String(i + 1).padStart(4, '0')}`,
          name: `${cat.category} Product ${i + 1}`,
          description: `${QA_MARKER} ${cat.category} item for QA testing`,
          category: cat.category,
          unit: cat.unit,
          costPrice: cost,
          salePrice: round2(cost * markup),
          quantity: 10 + (i % 200),
          minQuantity: 5,
        },
      })
    }

    // --- 100 invoices ---
    const now = new Date()
    const invoiceTypes: InvoiceType[] = ['STANDARD', 'SIMPLIFIED', 'CREDIT_NOTE', 'DEBIT_NOTE']
    const statuses = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'PARTIAL'] as const

    for (let i = 0; i < 100; i++) {
      const customer = customers[i % customers.length]
      const invoiceType = invoiceTypes[i % invoiceTypes.length]
      const status = statuses[i % statuses.length]
      const daysAgo = i % 90
      const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)
      const dueDate = new Date(date.getTime() + (30 + (i % 30)) * 24 * 60 * 60 * 1000)

      const qty = 1 + (i % 5)
      const unitPrice = round2(500 + (i % 20) * 250)
      const taxRate = pick(VAT_RATES, i)
      const subtotal = round2(qty * unitPrice)
      const taxAmount = round2(subtotal * (taxRate / 100))
      const total = round2(subtotal + taxAmount)

      let amountPaid = 0
      let balance = total
      if (status === 'PAID') {
        amountPaid = total
        balance = 0
      } else if (status === 'PARTIAL') {
        amountPaid = round2(total * 0.5)
        balance = round2(total - amountPaid)
      }

      const inv = await prisma.invoice.create({
        data: {
          invoiceNo: await getNextSequence(prisma, 'INVOICE', 'INV-'),
          invoiceUUID: randomUUID(),
          invoiceType,
          customerId: customer.id,
          date,
          issueTime: formatIssueTime(date),
          dueDate,
          status: status === 'PARTIAL' ? 'SENT' : status,
          subtotal,
          taxAmount,
          total,
          amountPaid,
          balance,
          notes: `${QA_MARKER} QA invoice #${i + 1} type=${invoiceType} status=${status}`,
          createdById: admin.id,
          zatcaStatus: status === 'DRAFT' ? 'DRAFT' : 'DRAFT',
          lines: {
            create: [{
              description: `${QA_MARKER} Line item — ${pick(PRODUCT_CATEGORIES, i).category}`,
              quantity: qty,
              unitPrice,
              taxRate,
              amount: subtotal,
              accountId: revenueAcct?.id,
              costCenterId: costCenter?.id,
            }],
          },
        },
      })

      if (amountPaid > 0) {
        await prisma.payment.create({
          data: {
            paymentNo: await getNextSequence(prisma, 'PAYMENT', 'PAY-'),
            date: new Date(),
            amount: amountPaid,
            method: 'BANK_TRANSFER',
            reference: `QA-PAY-${i + 1}`,
            notes: QA_MARKER,
            invoiceId: inv.id,
          },
        })
      }
    }

    // Ensure company settings are ZATCA sandbox-ready
    const settings = await prisma.companySettings.findFirst()
    if (settings) {
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          taxId: settings.taxId ?? '300000000000003',
          commercialRegistration: settings.commercialRegistration ?? '1010000000',
          streetAddress: settings.streetAddress ?? 'King Fahd Road',
          buildingNumber: settings.buildingNumber ?? '4521',
          district: settings.district ?? 'Al Olaya',
          city: settings.city ?? 'Riyadh',
          postalCode: settings.postalCode ?? '12211',
          zatcaEnabled: true,
        },
      })
    }

    return {
      status: force ? 'reset' : 'created',
      customers: 50,
      inventory: 100,
      invoices: 100,
      vendors: 10,
      message: `QA seed complete: 50 customers, 100 inventory items, 100 invoices, 10 vendors. Marker: ${QA_MARKER}`,
    }
  } finally {
    if (ownsClient) await prisma.$disconnect()
  }
}
