import { requireAuth } from '@/lib/auth'
import { getInvoiceRepository } from '@/lib/db/provider'
import type { InvoiceListOptions } from '@/lib/db/repositories/invoice.repository.interface'

function pickParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)
  return value && value.trim() ? value.trim() : undefined
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const options: InvoiceListOptions = {
      search: pickParam(searchParams, 'search'),
      status: pickParam(searchParams, 'status'),
      zatcaStatus: pickParam(searchParams, 'zatcaStatus'),
      invoiceType: pickParam(searchParams, 'invoiceType'),
      customerId: pickParam(searchParams, 'customerId'),
      datePreset: pickParam(searchParams, 'datePreset') as InvoiceListOptions['datePreset'],
      dateFrom: pickParam(searchParams, 'dateFrom'),
      dateTo: pickParam(searchParams, 'dateTo'),
      overdue: searchParams.get('overdue') === 'true' ? true : undefined,
      sortBy: pickParam(searchParams, 'sortBy') as InvoiceListOptions['sortBy'],
      sortDir: pickParam(searchParams, 'sortDir') as InvoiceListOptions['sortDir'],
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    }
    const result = await getInvoiceRepository().findMany(options)
    return Response.json(result)
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
