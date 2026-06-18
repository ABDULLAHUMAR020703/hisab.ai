/**
 * QA database integrity verification.
 * Run: npm run qa:verify
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getSqliteDatabaseUrl } from '../src/lib/sqlite-db.ts'

const { PrismaClient } = await import('@prisma/client')

function createPrisma() {
  const adapter = new PrismaBetterSqlite3({ url: getSqliteDatabaseUrl() })
  return new PrismaClient({ adapter })
}

/** @type {{ name: string, passed: boolean, detail: string }[]} */
const checks = []

function record(name, passed, detail) {
  checks.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}: ${detail}`)
}

const prisma = createPrisma()

try {
  const dupCustomers = await prisma.$queryRaw`
    SELECT "customerNo", COUNT(*) as cnt FROM "Customer" GROUP BY "customerNo" HAVING COUNT(*) > 1
  `
  record('Unique customer numbers', dupCustomers.length === 0, dupCustomers.length ? `${dupCustomers.length} duplicates` : 'OK')

  const dupInvoices = await prisma.$queryRaw`
    SELECT "invoiceNo", COUNT(*) as cnt FROM "Invoice" GROUP BY "invoiceNo" HAVING COUNT(*) > 1
  `
  record('Unique invoice numbers', dupInvoices.length === 0, dupInvoices.length ? `${dupInvoices.length} duplicates` : 'OK')

  const invoices = await prisma.invoice.findMany({ include: { lines: true }, take: 200 })
  let totalMismatch = 0
  for (const inv of invoices) {
    const lineSubtotal = inv.lines.reduce((s, l) => s + l.amount, 0)
    if (Math.abs(lineSubtotal - inv.subtotal) > 0.02) totalMismatch++
  }
  record('Invoice subtotal vs lines', totalMismatch === 0, totalMismatch ? `${totalMismatch} mismatches` : `Checked ${invoices.length} invoices`)

  const orphanLines = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM "InvoiceLine" il
    LEFT JOIN "Invoice" i ON il."invoiceId" = i.id
    WHERE i.id IS NULL
  `
  record('No orphan invoice lines', Number(orphanLines[0]?.cnt ?? 0) === 0, `${orphanLines[0]?.cnt ?? 0} orphans`)

  const overpaid = invoices.filter((i) => i.amountPaid > i.total + 0.02)
  record('No overpaid invoices', overpaid.length === 0, overpaid.length ? `${overpaid.length} overpaid` : 'OK')

  const zatcaCredCount = await prisma.zatcaCredential.count()
  record('Table ZatcaCredential', true, `${zatcaCredCount} rows`)

  const auditCount = await prisma.zatcaAuditLog.count()
  record('Table ZatcaAuditLog', true, `${auditCount} rows`)

  const sandboxCount = await prisma.zatcaSandboxTestRun.count()
  record('Table ZatcaSandboxTestRun', true, `${sandboxCount} rows`)

  const settingsCount = await prisma.companySettings.count()
  record('Company settings exists', settingsCount >= 1, `${settingsCount} row(s)`)

  const userCount = await prisma.user.count()
  record('Users seeded', userCount >= 2, `${userCount} users`)

  const passed = checks.filter((c) => c.passed).length
  const failed = checks.length - passed
  console.log(`\n${passed}/${checks.length} checks passed${failed ? ` (${failed} FAILED)` : ''}`)
  process.exit(failed > 0 ? 1 : 0)
} finally {
  await prisma.$disconnect()
}
