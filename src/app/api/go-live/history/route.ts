import { requireRole, authzErrorResponse } from '@/lib/authz'
import { listReadinessHistory } from '@/lib/go-live'

export async function GET() {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const history = await listReadinessHistory(user.companyId, 60)
    return Response.json({ history })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
