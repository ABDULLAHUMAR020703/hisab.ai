import { requireAuth } from '@/lib/auth'
import { createAppUser, listAppUsers } from '@/lib/supabase/auth-users'

export async function GET() {
  try {
    await requireAuth()
    return Response.json(await listAppUsers())
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    if (!body.email || !body.password) {
      return Response.json({ error: 'email and password required' }, { status: 400 })
    }

    const user = await createAppUser({
      name: body.name,
      email: body.email,
      password: body.password,
      role: body.role || 'ACCOUNTANT',
    })

    return Response.json(user, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
