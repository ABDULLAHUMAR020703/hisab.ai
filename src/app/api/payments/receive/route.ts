import { requireAuth } from '@/lib/auth'
import { postPaymentToLedger } from '@/lib/accounting/document-posting'
import { getCompanyPrimaryCurrency } from '@/lib/currency/company'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'

interface ReceivePaymentInput {
  invoiceId: string
  amount: number
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const body = await request.json()
    const payments: ReceivePaymentInput[] = body.payments ?? []

    if (!Array.isArray(payments) || payments.length === 0) {
      return Response.json({ error: 'payments array is required' }, { status: 400 })
    }

    const paymentDate = body.date ? new Date(body.date) : new Date()
    const method = body.method ?? 'BANK_TRANSFER'
    const reference = body.reference ?? null
    const notes = body.notes ?? null
    const bankAccountId = body.bankAccountId ?? null

    const client = createAdminClient()
    const results: Array<{ invoiceId: string; paymentId: string; amount: number; status: string }> = []

    for (const entry of payments) {
      const invoiceId = String(entry.invoiceId ?? '')
      const requestedAmount = Number(entry.amount)

      if (!invoiceId || Number.isNaN(requestedAmount) || requestedAmount <= 0) {
        return Response.json({ error: 'Each payment requires invoiceId and a positive amount' }, { status: 400 })
      }

      const { data: invoice, error: invoiceError } = await client
        .from('invoices')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', invoiceId)
        .is('deleted_at', null)
        .maybeSingle()

      if (invoiceError) throw invoiceError
      if (!invoice) return Response.json({ error: `Invoice not found: ${invoiceId}` }, { status: 404 })

      const balance = Number(invoice.balance)
      if (balance <= 0) {
        return Response.json({ error: `Invoice ${invoice.invoice_no} is already fully paid` }, { status: 400 })
      }

      const amount = Math.min(requestedAmount, balance)
      const paymentNo = await getNextSequence('PAYMENT', 'PAY-')
      const currency = String(invoice.currency ?? await getCompanyPrimaryCurrency())

      const { data: payment, error: paymentError } = await client
        .from('payments')
        .insert({
          company_id: companyId,
          payment_no: paymentNo,
          invoice_id: invoiceId,
          date: paymentDate.toISOString(),
          currency,
          amount,
          method,
          reference,
          notes,
          bank_account_id: bankAccountId,
        })
        .select('*')
        .single()

      if (paymentError) throw paymentError

      const newAmountPaid = Number(invoice.amount_paid) + amount
      const newBalance = Number(invoice.total) - newAmountPaid
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

      const { error: updateError } = await client
        .from('invoices')
        .update({
          amount_paid: newAmountPaid,
          balance: newBalance,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('id', invoiceId)

      if (updateError) throw updateError

      await postPaymentToLedger(String(payment.id), companyId)

      results.push({
        invoiceId,
        paymentId: String(payment.id),
        amount,
        status: newStatus,
      })
    }

    return Response.json({ payments: results }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
