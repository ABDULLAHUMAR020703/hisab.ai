import 'server-only'
import PDFDocument from 'pdfkit'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { mapCustomerRow, mapInvoiceRow, mapPaymentRow } from '@/lib/db/entity-mappers'
import { queryByIdOrLegacy } from '@/lib/db/repository-utils'
import { formatMoney, formatPdfDate } from '@/lib/invoices/pdf/format'

export interface CustomerStatementData {
  customer: ReturnType<typeof mapCustomerRow>
  period: { from: string | null; to: string | null }
  openingBalance: number
  closingBalance: number
  invoices: Array<{
    id: string
    invoiceNo: string
    date: string
    dueDate: string
    total: number
    balance: number
    status: string
  }>
  payments: Array<{
    id: string
    paymentNo: string
    date: string
    amount: number
    method: string
    reference: string | null
  }>
  currency: string
}

export async function loadCustomerStatement(
  customerId: string,
  options: { from?: string | null; to?: string | null } = {},
): Promise<CustomerStatementData> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  const scopedCustomerId = await queryByIdOrLegacy(client, 'customers', customerId, companyId)
  if (!scopedCustomerId) throw new Error('Customer not found')

  const customer = mapCustomerRow(scopedCustomerId)

  let invoiceQuery = client
    .from('invoices')
    .select('*')
    .eq('company_id', companyId)
    .eq('customer_id', customer.id)
    .is('deleted_at', null)
    .order('date', { ascending: true })

  if (options.from) invoiceQuery = invoiceQuery.gte('date', new Date(options.from).toISOString())
  if (options.to) invoiceQuery = invoiceQuery.lte('date', new Date(options.to).toISOString())

  const { data: invoiceRows, error: invoiceError } = await invoiceQuery
  if (invoiceError) throw invoiceError

  const invoices = (invoiceRows ?? []).map((row) => {
    const inv = mapInvoiceRow(row)
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      date: inv.date.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      total: inv.total,
      balance: inv.balance,
      status: inv.status,
    }
  })

  const invoiceIds = invoices.map((i) => i.id)
  let payments: CustomerStatementData['payments'] = []

  if (invoiceIds.length > 0) {
    let paymentQuery = client
      .from('payments')
      .select('*')
      .eq('company_id', companyId)
      .in('invoice_id', invoiceIds)
      .is('deleted_at', null)
      .order('date', { ascending: true })

    if (options.from) paymentQuery = paymentQuery.gte('date', new Date(options.from).toISOString())
    if (options.to) paymentQuery = paymentQuery.lte('date', new Date(options.to).toISOString())

    const { data: paymentRows, error: paymentError } = await paymentQuery
    if (paymentError) throw paymentError

    payments = (paymentRows ?? []).map((row) => {
      const payment = mapPaymentRow(row)
      return {
        id: payment.id,
        paymentNo: payment.paymentNo,
        date: payment.date.toISOString(),
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
      }
    })
  }

  const currency = invoices[0]?.total !== undefined
    ? (invoiceRows?.[0]?.currency as string | undefined) ?? 'SAR'
    : 'SAR'

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
  const closingBalance = invoices
    .filter((inv) => ['SENT', 'PARTIAL', 'OVERDUE'].includes(inv.status))
    .reduce((sum, inv) => sum + inv.balance, 0)
  const openingBalance = closingBalance - totalInvoiced + totalPaid

  return {
    customer,
    period: { from: options.from ?? null, to: options.to ?? null },
    openingBalance,
    closingBalance,
    invoices,
    payments,
    currency,
  }
}

export async function generateCustomerStatementPdf(data: CustomerStatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const { customer, period, openingBalance, closingBalance, invoices, payments, currency } = data

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Customer Statement', { align: 'center' })
    doc.moveDown(0.5)
    doc.font('Helvetica').fontSize(11).fillColor('#475569').text(customer.name, { align: 'center' })
    if (customer.email) doc.text(customer.email, { align: 'center' })
    doc.moveDown()

    const periodLabel = period.from || period.to
      ? `${period.from ? formatPdfDate(new Date(period.from)) : '—'} to ${period.to ? formatPdfDate(new Date(period.to)) : '—'}`
      : 'All transactions'
    doc.fontSize(9).fillColor('#94a3b8').text(`Period: ${periodLabel}`, { align: 'center' })
    doc.moveDown(1.5)

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text('Summary')
    doc.moveDown(0.5)
    doc.font('Helvetica').fontSize(10)
    doc.text(`Opening balance: ${formatMoney(openingBalance, currency)}`)
    doc.text(`Closing balance: ${formatMoney(closingBalance, currency)}`)
    doc.moveDown()

    doc.font('Helvetica-Bold').fontSize(10).text('Invoices')
    doc.moveDown(0.3)
    if (invoices.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text('No invoices in this period.')
    } else {
      for (const inv of invoices) {
        doc.font('Helvetica').fontSize(9).fillColor('#334155')
          .text(`${inv.invoiceNo} · ${formatPdfDate(new Date(inv.date))} · ${formatMoney(inv.total, currency)} · Bal ${formatMoney(inv.balance, currency)}`)
      }
    }
    doc.moveDown()

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text('Payments')
    doc.moveDown(0.3)
    if (payments.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text('No payments in this period.')
    } else {
      for (const payment of payments) {
        doc.font('Helvetica').fontSize(9).fillColor('#334155')
          .text(`${payment.paymentNo} · ${formatPdfDate(new Date(payment.date))} · ${formatMoney(payment.amount, currency)} (${payment.method})`)
      }
    }

    doc.end()
  })
}
