import { requireAuth } from '@/lib/auth'
import { deleteAppUser, updateAppUser } from '@/lib/supabase/auth-users'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await request.json()

    const user = await updateAppUser(id, session.companyId, {
      name: body.name,
      role: body.role,
      isActive: body.isActive,
      password: body.password,
    })

    return Response.json(user)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await requireAuth()
    const { id } = await params

    if (currentUser.id === id) {
      return Response.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await deleteAppUser(id)
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
