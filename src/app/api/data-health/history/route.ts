import { requireRole, authzErrorResponse } from '@/lib/authz'
import { listHealthHistory } from '@/lib/data-health'

export async function GET() {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const history = await listHealthHistory(user.companyId, 60)
    return Response.json({ history })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
