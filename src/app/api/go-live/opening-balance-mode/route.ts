import { requireRole, authzErrorResponse } from '@/lib/authz'
import { logAudit } from '@/lib/audit/log'
import { createAdminClient } from '@/lib/supabase/admin'
import type { OpeningBalanceMode } from '@/lib/go-live'

export async function POST(request: Request) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const body = await request.json()
    const mode = String(body.mode ?? '') as OpeningBalanceMode

    if (!['EXISTING_BUSINESS', 'NEW_BUSINESS_ZERO'].includes(mode)) {
      return Response.json(
        { error: 'mode must be EXISTING_BUSINESS or NEW_BUSINESS_ZERO' },
        { status: 400 },
      )
    }

    if (mode === 'NEW_BUSINESS_ZERO' && !body.acknowledge) {
      return Response.json(
        { error: 'Acknowledge start with zero opening balances' },
        { status: 400 },
      )
    }

    const db = createAdminClient()
    const patch: Record<string, unknown> = {
      opening_balance_mode: mode,
      updated_at: new Date().toISOString(),
    }
    if (mode === 'NEW_BUSINESS_ZERO') {
      patch.opening_balance_acknowledged_at = new Date().toISOString()
      patch.opening_balance_acknowledged_by = user.id
    }

    const { error } = await db.from('companies').update(patch).eq('id', user.companyId)
    if (error) throw error

    await logAudit({
      action: 'OPENING_BALANCE_MODE_SET',
      entityType: 'company',
      entityId: user.companyId,
      userId: user.id,
      companyId: user.companyId,
      details: { mode },
    })

    return Response.json({ ok: true, mode })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
