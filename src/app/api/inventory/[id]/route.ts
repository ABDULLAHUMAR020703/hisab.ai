import { requireAuth } from '@/lib/auth'
import { getInventoryRepository } from '@/lib/db/provider'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const item = await getInventoryRepository().findById(id)
    if (!item) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(item)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        category: body.category,
        unit: body.unit,
        costPrice: body.costPrice,
        salePrice: body.salePrice,
        quantity: body.quantity,
        minQuantity: body.minQuantity,
        isActive: body.isActive,
      },
    })
    return Response.json(item)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    await prisma.inventoryItem.delete({ where: { id } })
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
