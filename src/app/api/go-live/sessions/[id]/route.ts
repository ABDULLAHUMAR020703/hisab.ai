import { requireRole, authzErrorResponse } from '@/lib/authz'
import { getGoLiveSession } from '@/lib/go-live'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const { id } = await context.params
    const session = await getGoLiveSession(id, user.companyId)
    if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ session })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
