import { requireAuth } from '@/lib/auth'
import { toCamel } from '@/lib/api/db-transform'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const client = createAdminClient()

    const { data, error } = await client
      .from('bank_reconciliations')
      .select('*, bank_account:bank_accounts(name, currency, current_balance)')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(toCamel(data))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const body = await request.json()
    const client = createAdminClient()

    const { data: existing, error: findError } = await client
      .from('bank_reconciliations')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (findError) throw findError
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const nextStatus = body.status ?? existing.status
    const patch: Record<string, unknown> = {}
    if (body.statementDate !== undefined) patch.statement_date = new Date(body.statementDate).toISOString()
    if (body.statementBalance !== undefined) patch.statement_balance = Number(body.statementBalance)
    if (body.reconciledBalance !== undefined) patch.reconciled_balance = Number(body.reconciledBalance)
    if (body.status !== undefined) patch.status = body.status
    if (nextStatus === 'COMPLETED' && existing.status !== 'COMPLETED') {
      patch.completed_at = new Date().toISOString()
    }

    const { data, error } = await client
      .from('bank_reconciliations')
      .update(patch)
      .eq('id', id)
      .eq('company_id', companyId)
      .select('*, bank_account:bank_accounts(name, currency, current_balance)')
      .single()

    if (error) throw error

    if (nextStatus === 'COMPLETED') {
      await client
        .from('bank_transactions')
        .update({ status: 'RECONCILED' })
        .eq('company_id', companyId)
        .eq('bank_account_id', existing.bank_account_id)
        .eq('status', 'MATCHED')
    }

    return Response.json(toCamel(data))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const client = createAdminClient()

    const { error } = await client
      .from('bank_reconciliations')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (error) throw error
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
