import { requireAuth } from '@/lib/auth'
import { authzErrorResponse } from '@/lib/authz'
import { requireRecurringPermission } from '@/lib/recurring-transactions/permissions'
import { executeRecurringTemplate } from '@/lib/recurring-transactions/service'

export async function POST(_request: Request, context: RouteContext<'/api/recurring-transactions/[id]/run'>) {
  try {
    const user = await requireAuth(); const access = await requireRecurringPermission(user, 'run')
    const { id } = await context.params
    const template = await executeRecurringTemplate(access.companyId, user.id, id)
    return template ? Response.json(template) : Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return authzErrorResponse(error) }
}
