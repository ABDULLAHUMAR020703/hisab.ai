import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getNextSequence } from '@/lib/sequences'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
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

    await prisma.payment.create({
      data: {
        paymentNo,
        billId: id,
        date: new Date(body.date || new Date()),
        amount,
        method: body.method || 'BANK_TRANSFER',
        reference: body.reference,
        notes: body.notes,
      },
    })

    const newAmountPaid = bill.amountPaid + amount
    const newBalance = bill.total - newAmountPaid
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

    const updated = await prisma.bill.update({
      where: { id },
      data: { amountPaid: newAmountPaid, balance: newBalance, status: newStatus },
    })

    return Response.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
