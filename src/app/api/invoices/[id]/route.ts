import { requireAuth } from '@/lib/auth'
import { getInvoiceRepository } from '@/lib/db/provider'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const invoice = await getInvoiceRepository().findById(id)
    if (!invoice) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(invoice)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()
    const invoice = await getInvoiceRepository().update(id, {
      customerId: body.customerId,
      date: body.date,
      dueDate: body.dueDate,
      lines: body.lines,
      notes: body.notes,
      terms: body.terms,
      status: body.status,
    })
    return Response.json(invoice)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'Invoice not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Cannot edit paid invoice') {
      return Response.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'Customer not found') {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    await getInvoiceRepository().delete(id)
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'Invoice not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Cannot delete paid invoice') {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
