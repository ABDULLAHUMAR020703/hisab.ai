import { requireAuth } from '@/lib/auth'
import { authzErrorResponse } from '@/lib/authz'
import { requireRecurringPermission } from '@/lib/recurring-transactions/permissions'
import { exportRecurringTemplates } from '@/lib/recurring-transactions/service'

export async function GET(request: Request) {
  try {
    const user = await requireAuth()
    const access = await requireRecurringPermission(user, 'export')
    const csv = await exportRecurringTemplates(access.companyId, request.url)
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="recurring-transactions.csv"', 'Cache-Control': 'private, no-store' } })
  } catch (error) { return authzErrorResponse(error) }
}
