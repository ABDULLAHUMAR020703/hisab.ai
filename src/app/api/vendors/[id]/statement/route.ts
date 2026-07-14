import { requireAuth } from '@/lib/auth'
import { toCamel } from '@/lib/api/db-transform'
import { createAdminClient } from '@/lib/supabase/admin'
import { queryByIdOrLegacy } from '@/lib/db/repository-utils'
import { resolveCompanyId } from '@/lib/tenant'

interface StatementEntry {
  date: string
  type: 'BILL' | 'PAYMENT' | 'VENDOR_CREDIT'
  reference: string
  description: string
  debit: number
  credit: number
  balance: number
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const client = createAdminClient()

    const vendorRow = await queryByIdOrLegacy(client, 'vendors', id, companyId)
    if (!vendorRow) return Response.json({ error: 'Vendor not found' }, { status: 404 })

    const vendorId = String(vendorRow.id)

    let billsQuery = client
      .from('bills')
      .select('id, bill_no, date, total, amount_paid, balance, status, reference')
      .eq('company_id', companyId)
      .eq('vendor_id', vendorId)
      .is('deleted_at', null)
      .neq('status', 'VOID')

    let creditsQuery = client
      .from('vendor_credits')
      .select('id, credit_no, date, total, status, notes')
      .eq('company_id', companyId)
      .eq('vendor_id', vendorId)
      .is('deleted_at', null)
      .neq('status', 'VOID')

    if (dateFrom) {
      billsQuery = billsQuery.gte('date', new Date(dateFrom).toISOString())
      creditsQuery = creditsQuery.gte('date', new Date(dateFrom).toISOString())
    }
    if (dateTo) {
      billsQuery = billsQuery.lte('date', new Date(dateTo).toISOString())
      creditsQuery = creditsQuery.lte('date', new Date(dateTo).toISOString())
    }

    const [billsRes, creditsRes] = await Promise.all([
      billsQuery.order('date', { ascending: true }),
      creditsQuery.order('date', { ascending: true }),
    ])

    if (billsRes.error) throw billsRes.error
    if (creditsRes.error) throw creditsRes.error

    const bills = billsRes.data ?? []
    const billIds = bills.map((b) => b.id)

    let payments: Array<Record<string, unknown>> = []
    if (billIds.length > 0) {
      let vendorPaymentsQuery = client
        .from('payments')
        .select('id, payment_no, date, amount, reference, bill_id')
        .eq('company_id', companyId)
        .in('bill_id', billIds)

      if (dateFrom) vendorPaymentsQuery = vendorPaymentsQuery.gte('date', new Date(dateFrom).toISOString())
      if (dateTo) vendorPaymentsQuery = vendorPaymentsQuery.lte('date', new Date(dateTo).toISOString())

      const paymentsRes = await vendorPaymentsQuery.order('date', { ascending: true })
      if (paymentsRes.error) throw paymentsRes.error
      payments = paymentsRes.data ?? []
    }

    const credits = creditsRes.data ?? []

    const rawEntries: Omit<StatementEntry, 'balance'>[] = [
      ...bills.map((bill) => ({
        date: String(bill.date),
        type: 'BILL' as const,
        reference: String(bill.bill_no),
        description: bill.reference ? `Bill ${bill.bill_no} (${bill.reference})` : `Bill ${bill.bill_no}`,
        debit: Number(bill.total),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        date: String(payment.date),
        type: 'PAYMENT' as const,
        reference: String(payment.payment_no),
        description: payment.reference ? `Payment ${payment.payment_no} (${payment.reference})` : `Payment ${payment.payment_no}`,
        debit: 0,
        credit: Number(payment.amount),
      })),
      ...credits.map((credit) => ({
        date: String(credit.date),
        type: 'VENDOR_CREDIT' as const,
        reference: String(credit.credit_no),
        description: credit.notes ? `Credit ${credit.credit_no} — ${credit.notes}` : `Credit ${credit.credit_no}`,
        debit: 0,
        credit: Number(credit.total),
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    let running = 0
    const entries: StatementEntry[] = rawEntries.map((entry) => {
      running += entry.debit - entry.credit
      return { ...entry, balance: running }
    })

    const totalBilled = bills.reduce((sum, bill) => sum + Number(bill.total), 0)
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const totalCredits = credits.reduce((sum, credit) => sum + Number(credit.total), 0)
    const outstanding = bills.reduce((sum, bill) => sum + Number(bill.balance), 0)

    return Response.json({
      vendor: toCamel(vendorRow),
      summary: {
        totalBilled,
        totalPaid,
        totalCredits,
        outstanding,
        closingBalance: totalBilled - totalPaid - totalCredits,
      },
      entries,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
