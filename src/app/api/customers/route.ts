import { requireAuth } from '@/lib/auth'
import { getCustomerRepository } from '@/lib/db/provider'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? undefined
    const customers = await getCustomerRepository().findMany({ search })
    return Response.json(customers)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const customer = await getCustomerRepository().create({
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      city: body.city,
      country: body.country,
      taxId: body.taxId,
      creditLimit: body.creditLimit || 0,
      paymentTerms: body.paymentTerms || 30,
    })
    return Response.json(customer, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
