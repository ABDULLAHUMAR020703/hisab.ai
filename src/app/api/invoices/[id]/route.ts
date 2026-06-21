import { requireAuth } from '@/lib/auth'
import { getInvoiceRepository } from '@/lib/db/provider'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const invoice = await getInvoiceRepository().findById(id)
    if (!invoice) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(invoice)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
    if (existing.status === 'PAID') return Response.json({ error: 'Cannot edit paid invoice' }, { status: 400 })

    let subtotal = 0
    let taxAmount = 0
    const processedLines = (body.lines || []).map((l: {
      description: string; quantity: number; unitPrice: number; taxRate: number
      accountId?: string; costCenterId?: string
    }) => {
      const lineAmount = l.quantity * l.unitPrice
      const lineTax = lineAmount * (l.taxRate / 100)
      subtotal += lineAmount
      taxAmount += lineTax
      return { ...l, amount: lineAmount }
    })

    const total = subtotal + taxAmount
    const balance = total - existing.amountPaid

    await prisma.invoiceLine.deleteMany({ where: { invoiceId: id } })

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        customerId: body.customerId,
        date: new Date(body.date),
        dueDate: new Date(body.dueDate),
        subtotal,
        taxAmount,
        total,
        balance,
        notes: body.notes,
        terms: body.terms,
        status: body.status || existing.status,
        lines: {
          create: processedLines.map((l: {
            description: string; quantity: number; unitPrice: number
            taxRate: number; amount: number; accountId?: string; costCenterId?: string
          }) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            amount: l.amount,
            accountId: l.accountId || null,
            costCenterId: l.costCenterId || null,
          })),
        },
      },
      include: { customer: { select: { name: true } }, lines: true },
    })

    return Response.json(invoice)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const inv = await prisma.invoice.findUnique({ where: { id } })
    if (inv?.status === 'PAID') return Response.json({ error: 'Cannot delete paid invoice' }, { status: 400 })
    await prisma.invoice.delete({ where: { id } })
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
