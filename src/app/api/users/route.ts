import { authzErrorResponse, requireRole } from '@/lib/authz'
import { createAppUser, listAppUsers } from '@/lib/supabase/auth-users'

export async function GET() {
  try {
    const session = await requireRole(['OWNER', 'ADMIN'])
    return Response.json(await listAppUsers(session.companyId))
  } catch (error) {
    return authzErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(['OWNER', 'ADMIN'])
    const body = await request.json()

    if (!body.email || !body.password) {
      return Response.json({ error: 'email and password required' }, { status: 400 })
    }

    const user = await createAppUser({
      name: body.name,
      email: body.email,
      password: body.password,
      role: body.role || 'ACCOUNTANT',
      companyId: session.companyId,
    })

    return Response.json(user, { status: 201 })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
