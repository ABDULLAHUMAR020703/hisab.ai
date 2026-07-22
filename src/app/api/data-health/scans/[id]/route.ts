import { requireRole, authzErrorResponse } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const { id } = await context.params
    const db = createAdminClient()
    const { data, error } = await db
      .from('data_health_scans')
      .select('*')
      .eq('id', id)
      .eq('company_id', user.companyId)
      .maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ scan: data })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
