import { requireAuth } from '@/lib/auth'
import { getCostCenterRepository } from '@/lib/db/provider'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()
    const center = await getCostCenterRepository().update(id, {
      name: body.name,
      type: body.type,
      description: body.description,
      isActive: body.isActive,
      metadata: body.metadata,
    })
    return Response.json(center)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'Cost center not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    await getCostCenterRepository().delete(id)
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'Cost center not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
