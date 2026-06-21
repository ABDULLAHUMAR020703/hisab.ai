import { requireAuth } from '@/lib/auth'
import { getVendorRepository } from '@/lib/db/provider'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const vendor = await getVendorRepository().findById(id)
    if (!vendor) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(vendor)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()
    const vendor = await getVendorRepository().update(id, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      city: body.city,
      country: body.country,
      taxId: body.taxId,
      paymentTerms: body.paymentTerms,
      isActive: body.isActive,
    })
    return Response.json(vendor)
  } catch (error) {
    if (error instanceof Error && error.message === 'Vendor not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    await getVendorRepository().delete(id)
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Vendor not found') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
