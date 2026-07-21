import { requireAuth } from '@/lib/auth'
import { getCostCenterRepository } from '@/lib/db/provider'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const type = searchParams.get('type') ?? undefined

    const centers = await getCostCenterRepository().findMany({
      search: search || undefined,
      type: type || undefined,
      activeOnly: searchParams.get('activeOnly') === 'true',
    })
    return Response.json(centers)
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
      return Response.json({ error: 'Cost center name is required' }, { status: 400 })
    }

    const center = await getCostCenterRepository().create({
      code: body.code,
      name,
      type: body.type || 'PROJECT',
      description: body.description,
    })

    return Response.json(center, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
