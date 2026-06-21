import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth'
import { getInvoiceRepository } from '@/lib/db/provider'
import { prisma } from '@/lib/prisma'
import { getNextSequence } from '@/lib/sequences'

function formatIssueTime(date: Date): string {
  return date.toTimeString().split(' ')[0]
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? undefined
    const status = searchParams.get('status') ?? undefined
    const invoices = await getInvoiceRepository().findMany({ search, status })
    return Response.json(invoices)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const body = await request.json()
    const { customerId, date, dueDate, lines, notes, terms, isRecurring, recurringDay } = body

    if (!customerId || !date || !dueDate || !lines?.length) {
      return Response.json({ error: 'customerId, date, dueDate, lines are required' }, { status: 400 })
    }

    let subtotal = 0
    let taxAmount = 0
    const processedLines = lines.map((l: {
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
    const invoiceNo = await getNextSequence('INVOICE', 'INV-')
    const issueDate = new Date(date)

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo,
        invoiceUUID: randomUUID(),
        customerId,
        date: issueDate,
        issueTime: formatIssueTime(issueDate),
        dueDate: new Date(dueDate),
        subtotal,
        taxAmount,
        total,
        balance: total,
        notes,
        terms,
        isRecurring: isRecurring || false,
        recurringDay: recurringDay || null,
        createdById: user.id,
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

    return Response.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
