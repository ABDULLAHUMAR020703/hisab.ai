import { requireAuth } from '@/lib/auth'
import { postPaymentToLedger } from '@/lib/accounting/document-posting'
import { getCompanyPrimaryCurrency } from '@/lib/currency/company'
import { prisma } from '@/lib/prisma'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const body = await request.json()

    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 })
    if (invoice.balance <= 0) return Response.json({ error: 'Invoice is already fully paid' }, { status: 400 })

    const requestedAmount = Number(body.amount)
    if (Number.isNaN(requestedAmount) || requestedAmount <= 0) {
      return Response.json({ error: 'A positive payment amount is required' }, { status: 400 })
    }

    const amount = Math.min(requestedAmount, invoice.balance)
    const paymentNo = await getNextSequence('PAYMENT', 'PAY-')
    const currency = invoice.currency || await getCompanyPrimaryCurrency()

    const payment = await prisma.payment.create({
      data: {
        paymentNo,
        invoiceId: id,
        date: new Date(body.date || new Date()),
        currency,
        amount,
        method: body.method || 'BANK_TRANSFER',
        reference: body.reference,
        notes: body.notes,
      },
    })

    const newAmountPaid = invoice.amountPaid + amount
    const newBalance = invoice.total - newAmountPaid
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

    const updated = await prisma.invoice.update({
      where: { id },
      data: { amountPaid: newAmountPaid, balance: newBalance, status: newStatus },
    })

    await postPaymentToLedger(payment.id, companyId)

    return Response.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
