import { requireAuth } from '@/lib/auth'
import { getInvoiceRepository } from '@/lib/db/provider'

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

    const invoice = await getInvoiceRepository().create({
      customerId,
      date,
      dueDate,
      lines,
      notes,
      terms,
      isRecurring,
      recurringDay,
      createdById: user.id,
    })

    return Response.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'Customer not found') {
      return Response.json({ error: 'Customer not found' }, { status: 400 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
