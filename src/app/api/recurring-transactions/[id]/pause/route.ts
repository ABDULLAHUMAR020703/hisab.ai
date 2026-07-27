import { requireAuth } from '@/lib/auth'
import { authzErrorResponse } from '@/lib/authz'
import { requireRecurringPermission } from '@/lib/recurring-transactions/permissions'
import { setRecurringStatus } from '@/lib/recurring-transactions/service'

export async function POST(_request: Request, context: RouteContext<'/api/recurring-transactions/[id]/pause'>) {
  try {
    const user = await requireAuth(); const access = await requireRecurringPermission(user, 'pause')
    const { id } = await context.params
    const template = await setRecurringStatus(access.companyId, user.id, id, 'PAUSED')
    return template ? Response.json(template) : Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return authzErrorResponse(error) }
}
