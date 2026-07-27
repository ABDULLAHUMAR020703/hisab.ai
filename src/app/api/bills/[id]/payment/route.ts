import { postPaymentToLedger } from '@/lib/accounting/document-posting'
import { getCompanyPrimaryCurrency } from '@/lib/currency/company'
import { prisma } from '@/lib/prisma'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import { logAudit } from '@/lib/audit/log'
import { requireRole } from '@/lib/authz'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER'])
    const companyId = await resolveCompanyId()
    const { id } = await params
    const body = await request.json()

    const bill = await prisma.bill.findUnique({ where: { id } })
    if (!bill) return Response.json({ error: 'Bill not found' }, { status: 404 })
    if (bill.balance <= 0) return Response.json({ error: 'Bill is already fully paid' }, { status: 400 })

    const requestedAmount = Number(body.amount)
    if (Number.isNaN(requestedAmount) || requestedAmount <= 0) {
      return Response.json({ error: 'A positive payment amount is required' }, { status: 400 })
    }

    const amount = Math.min(requestedAmount, bill.balance)
    const paymentNo = await getNextSequence('PAYMENT', 'PAY-')
    const currency = bill.currency || await getCompanyPrimaryCurrency()

    const payment = await prisma.payment.create({
      data: {
        paymentNo,
        billId: id,
        date: new Date(body.date || new Date()),
        currency,
        amount,
        method: body.method || 'BANK_TRANSFER',
        reference: body.reference,
        notes: body.notes,
        bankAccountId: body.bankAccountId || null,
      },
    })

    const newAmountPaid = bill.amountPaid + amount
    const newBalance = bill.total - newAmountPaid
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

    const updated = await prisma.bill.update({
      where: { id },
      data: { amountPaid: newAmountPaid, balance: newBalance, status: newStatus },
    })

    await postPaymentToLedger(payment.id, companyId)
    await logAudit({
      companyId,
      userId: user.id,
      action: 'PAYMENT',
      entityType: 'bill',
      entityId: id,
      details: { paymentId: payment.id, amount, paymentNo },
    })

    return Response.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
