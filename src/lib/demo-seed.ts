import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getSqliteDatabaseUrl } from './sqlite-db'

function formatIssueTime(date: Date): string {
  return date.toTimeString().split(' ')[0]
}

function createPrisma() {
  const adapter = new PrismaBetterSqlite3({ url: getSqliteDatabaseUrl() })
  return new PrismaClient({ adapter })
}

async function getNextSequence(
  prisma: PrismaClient,
  type: string,
  prefix: string,
): Promise<string> {
  let seq = await prisma.sequence.findUnique({ where: { type } })
  if (!seq) {
    seq = await prisma.sequence.create({ data: { type, prefix, nextNo: 1 } })
  }
  const no = seq.nextNo
  await prisma.sequence.update({ where: { type }, data: { nextNo: no + 1 } })
  return `${prefix}${String(no).padStart(5, '0')}`
}

export async function seedDemoTransactions(
  prismaInstance?: PrismaClient,
): Promise<'created' | 'skipped' | string> {
  const prisma = prismaInstance ?? createPrisma()
  const ownsClient = !prismaInstance

  try {
    const existing = await prisma.customer.findFirst()
    if (existing) return 'skipped'

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    if (!admin) return 'No admin user found — run base seed first'

    const revenueAcct = await prisma.chartOfAccount.findFirst({
      where: { accountNo: '400101' },
    })
    const expenseAcct = await prisma.chartOfAccount.findFirst({
      where: { accountNo: '600401' },
    })
    const arAcct = await prisma.chartOfAccount.findFirst({
      where: { accountNo: '110201' },
    })
    const cashAcct = await prisma.chartOfAccount.findFirst({
      where: { accountNo: '110103' },
    })

    if (!revenueAcct || !expenseAcct || !arAcct || !cashAcct) {
      return 'Chart of accounts incomplete — run base seed first'
    }

    const costCenter = await prisma.costCenter.findFirst({ where: { code: 'CC-RYD' } })

    const cust1 = await prisma.customer.create({
      data: {
        customerNo: await getNextSequence(prisma, 'CUSTOMER', 'CUST-'),
        name: 'Saudi Telecom Company',
        email: 'billing@stc.com.sa',
        phone: '+966 11 455 0000',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        paymentTerms: 30,
      },
    })

    const cust2 = await prisma.customer.create({
      data: {
        customerNo: await getNextSequence(prisma, 'CUSTOMER', 'CUST-'),
        name: 'Mobily',
        email: 'accounts@mobily.com.sa',
        phone: '+966 11 520 0000',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        paymentTerms: 45,
      },
    })

    const vend1 = await prisma.vendor.create({
      data: {
        vendorNo: await getNextSequence(prisma, 'VENDOR', 'VEND-'),
        name: 'Office Supplies Co.',
        email: 'sales@officesupplies.sa',
        city: 'Riyadh',
        paymentTerms: 30,
      },
    })

    const vend2 = await prisma.vendor.create({
      data: {
        vendorNo: await getNextSequence(prisma, 'VENDOR', 'VEND-'),
        name: 'Cloud Hosting Ltd',
        email: 'billing@cloudhost.sa',
        city: 'Dammam',
        paymentTerms: 15,
      },
    })

    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10)
    const dueSoon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const overdue = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)

    await prisma.invoice.create({
      data: {
        invoiceNo: await getNextSequence(prisma, 'INVOICE', 'INV-'),
        invoiceUUID: randomUUID(),
        customerId: cust1.id,
        date: twoMonthsAgo,
        issueTime: formatIssueTime(twoMonthsAgo),
        dueDate: overdue,
        status: 'OVERDUE',
        subtotal: 50000,
        taxAmount: 7500,
        total: 57500,
        balance: 57500,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Network installation services',
            quantity: 1,
            unitPrice: 50000,
            taxRate: 15,
            amount: 50000,
            accountId: revenueAcct.id,
            costCenterId: costCenter?.id,
          }],
        },
      },
    })

    await prisma.invoice.create({
      data: {
        invoiceNo: await getNextSequence(prisma, 'INVOICE', 'INV-'),
        invoiceUUID: randomUUID(),
        customerId: cust2.id,
        date: lastMonth,
        issueTime: formatIssueTime(lastMonth),
        dueDate: dueSoon,
        status: 'SENT',
        subtotal: 32000,
        taxAmount: 4800,
        total: 36800,
        balance: 36800,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Monthly telecom maintenance',
            quantity: 1,
            unitPrice: 32000,
            taxRate: 15,
            amount: 32000,
            accountId: revenueAcct.id,
          }],
        },
      },
    })

    const paidInv = await prisma.invoice.create({
      data: {
        invoiceNo: await getNextSequence(prisma, 'INVOICE', 'INV-'),
        invoiceUUID: randomUUID(),
        customerId: cust1.id,
        date: lastMonth,
        issueTime: formatIssueTime(lastMonth),
        dueDate: lastMonth,
        status: 'PAID',
        subtotal: 15000,
        taxAmount: 2250,
        total: 17250,
        amountPaid: 17250,
        balance: 0,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Consulting — phase 1',
            quantity: 10,
            unitPrice: 1500,
            taxRate: 15,
            amount: 15000,
            accountId: revenueAcct.id,
          }],
        },
      },
    })

    await prisma.bill.create({
      data: {
        billNo: await getNextSequence(prisma, 'BILL', 'BILL-'),
        vendorId: vend1.id,
        date: lastMonth,
        dueDate: dueSoon,
        status: 'APPROVED',
        subtotal: 8500,
        taxAmount: 1275,
        total: 9775,
        balance: 9775,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Office stationery bulk order',
            quantity: 1,
            unitPrice: 8500,
            taxRate: 15,
            amount: 8500,
            accountId: expenseAcct.id,
          }],
        },
      },
    })

    await prisma.bill.create({
      data: {
        billNo: await getNextSequence(prisma, 'BILL', 'BILL-'),
        vendorId: vend2.id,
        date: now,
        dueDate: dueSoon,
        status: 'DRAFT',
        subtotal: 4200,
        taxAmount: 630,
        total: 4830,
        balance: 4830,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Cloud server hosting — Q2',
            quantity: 1,
            unitPrice: 4200,
            taxRate: 15,
            amount: 4200,
            accountId: expenseAcct.id,
          }],
        },
      },
    })

    await prisma.expense.create({
      data: {
        expenseNo: await getNextSequence(prisma, 'EXPENSE', 'EXP-'),
        date: now,
        description: 'Team lunch — client meeting',
        category: 'Meals & Entertainment',
        status: 'APPROVED',
        total: 1200,
        taxAmount: 0,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Restaurant bill',
            amount: 1200,
            taxRate: 0,
            accountId: expenseAcct.id,
          }],
        },
      },
    })

    await prisma.expense.create({
      data: {
        expenseNo: await getNextSequence(prisma, 'EXPENSE', 'EXP-'),
        date: now,
        description: 'Uber trips — site visit',
        category: 'Travel',
        status: 'PENDING',
        total: 450,
        taxAmount: 0,
        createdById: admin.id,
        lines: {
          create: [{
            description: 'Transport',
            amount: 450,
            taxRate: 0,
            accountId: expenseAcct.id,
          }],
        },
      },
    })

    await prisma.journalEntry.create({
      data: {
        entryNo: await getNextSequence(prisma, 'JOURNAL', 'JV-'),
        date: lastMonth,
        description: 'Record customer payment — consulting',
        status: 'POSTED',
        totalDebit: 17250,
        totalCredit: 17250,
        createdById: admin.id,
        lines: {
          create: [
            { accountId: cashAcct.id, debit: 17250, credit: 0, description: 'Bank deposit' },
            { accountId: arAcct.id, debit: 0, credit: 17250, description: 'Clear AR' },
          ],
        },
      },
    })

    await prisma.payment.create({
      data: {
        paymentNo: await getNextSequence(prisma, 'PAYMENT', 'PAY-'),
        date: lastMonth,
        amount: 17250,
        method: 'BANK_TRANSFER',
        reference: 'TRF-2024-001',
        invoiceId: paidInv.id,
      },
    })

    const emp = await prisma.employee.create({
      data: {
        employeeNo: await getNextSequence(prisma, 'EMPLOYEE', 'EMP-'),
        name: 'Ahmed Al-Rashid',
        email: 'ahmed@netkom.sa',
        department: 'Operations',
        position: 'Network Engineer',
        joiningDate: new Date(2022, 3, 1),
        salary: 12000,
      },
    })

    await prisma.employee.create({
      data: {
        employeeNo: await getNextSequence(prisma, 'EMPLOYEE', 'EMP-'),
        name: 'Sara Al-Qahtani',
        email: 'sara@netkom.sa',
        department: 'Administration',
        position: 'Accountant',
        joiningDate: new Date(2021, 8, 15),
        salary: 9500,
      },
    })

    await prisma.payrollEntry.create({
      data: {
        payrollNo: await getNextSequence(prisma, 'PAYROLL', 'PRL-'),
        employeeId: emp.id,
        period: `${now.toLocaleString('en', { month: 'long' })} ${now.getFullYear()}`,
        periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        basicSalary: 12000,
        allowances: 1500,
        deductions: 500,
        taxAmount: 0,
        netSalary: 13000,
        status: 'APPROVED',
        lines: {
          create: [
            { type: 'EARNING', description: 'Basic Salary', amount: 12000 },
            { type: 'EARNING', description: 'Transport Allowance', amount: 1500 },
            { type: 'DEDUCTION', description: 'GOSI Employee', amount: 500 },
          ],
        },
      },
    })

    for (const item of [
      { name: 'Cat6 Ethernet Cable (305m)', category: 'Cabling', unit: 'ROLL', costPrice: 450, salePrice: 620, quantity: 12, minQuantity: 5 },
      { name: 'Cisco Switch 24-port', category: 'Equipment', unit: 'PCS', costPrice: 2800, salePrice: 3500, quantity: 4, minQuantity: 2 },
    ]) {
      await prisma.inventoryItem.create({
        data: {
          itemCode: await getNextSequence(prisma, 'ITEM', 'ITEM-'),
          ...item,
        },
      })
    }

    await prisma.receipt.create({
      data: {
        fileName: 'fuel-receipt-may.pdf',
        filePath: '/uploads/demo/fuel-receipt-may.pdf',
        mimeType: 'application/pdf',
        vendor: 'ARAMCO Station',
        amount: 280,
        date: now,
        description: 'Fuel for company vehicle',
        status: 'UNPROCESSED',
        uploadedById: admin.id,
      },
    })

    return 'created'
  } finally {
    if (ownsClient) await prisma.$disconnect()
  }
}
