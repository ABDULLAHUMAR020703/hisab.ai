import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type TaxRow = { taxAmount: number; subtotal: number }

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : new Date(new Date().getFullYear(), 0, 1)
    const to = searchParams.get('to') ? new Date(searchParams.get('to')!) : new Date()

    // VAT collected (from invoices)
    const invoices = await prisma.invoice.findMany({
      where: {
        date: { gte: from, lte: to },
        status: { in: ['SENT', 'PAID', 'PARTIAL'] },
      },
      select: { taxAmount: true, subtotal: true },
    })

    const invoiceRows = invoices as TaxRow[]
    const vatCollected = invoiceRows.reduce((s: number, i: TaxRow) => s + i.taxAmount, 0)
    const salesAmount = invoiceRows.reduce((s: number, i: TaxRow) => s + i.subtotal, 0)

    // VAT paid (from bills)
    const bills = await prisma.bill.findMany({
      where: {
        date: { gte: from, lte: to },
        status: { in: ['RECEIVED', 'PAID', 'PARTIAL'] },
      },
      select: { taxAmount: true, subtotal: true },
    })

    const billRows = bills as TaxRow[]
    const vatPaid = billRows.reduce((s: number, b: TaxRow) => s + b.taxAmount, 0)
    const purchasesAmount = billRows.reduce((s: number, b: TaxRow) => s + b.subtotal, 0)

    const vatPayable = vatCollected - vatPaid

    return Response.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      sales: { amount: salesAmount, vatCollected, invoiceCount: invoices.length },
      purchases: { amount: purchasesAmount, vatPaid, billCount: bills.length },
      vatPayable,
      summary: vatPayable > 0 ? 'VAT PAYABLE TO ZATCA' : 'VAT REFUNDABLE FROM ZATCA',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
