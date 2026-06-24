import { requireAuth } from '@/lib/auth'
import { getCustomerRepository } from '@/lib/db/provider'
import type { CustomerListOptions } from '@/lib/db/repositories/customer.repository.interface'

function pickBool(searchParams: URLSearchParams, key: string): boolean | undefined {
  const value = searchParams.get(key)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const options: CustomerListOptions = {
      search: searchParams.get('search') ?? undefined,
      country: searchParams.get('country') ?? undefined,
      city: searchParams.get('city') ?? undefined,
      hasVat: pickBool(searchParams, 'hasVat'),
      hasOutstanding: pickBool(searchParams, 'hasOutstanding'),
      creditLimitExceeded: searchParams.get('creditLimitExceeded') === 'true' ? true : undefined,
      sortBy: (searchParams.get('sortBy') as CustomerListOptions['sortBy']) ?? undefined,
      sortDir: (searchParams.get('sortDir') as CustomerListOptions['sortDir']) ?? undefined,
    }
    const customers = await getCustomerRepository().findMany(options)
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
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return Response.json({ error: 'Customer name is required' }, { status: 400 })
    }

    const customer = await getCustomerRepository().create({
      name,
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
