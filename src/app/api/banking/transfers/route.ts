import { requireAuth } from '@/lib/auth'
import { toCamel } from '@/lib/api/db-transform'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { searchParams } = new URL(request.url)
    const fromAccountId = searchParams.get('fromAccountId') ?? ''
    const client = createAdminClient()

    let query = client
      .from('bank_transfers')
      .select('*')
      .eq('company_id', companyId)
      .order('date', { ascending: false })

    if (fromAccountId) query = query.eq('from_account_id', fromAccountId)

    const { data, error } = await query
    if (error) throw error
    return Response.json(toCamel(data ?? []))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const body = await request.json()
    const { fromAccountId, toAccountId, date, amount, reference } = body

    if (!fromAccountId || !toAccountId || !date || !amount) {
      return Response.json({ error: 'fromAccountId, toAccountId, date, amount are required' }, { status: 400 })
    }
    if (fromAccountId === toAccountId) {
      return Response.json({ error: 'Source and destination accounts must differ' }, { status: 400 })
    }

    const transferAmount = Number(amount)
    if (transferAmount <= 0) {
      return Response.json({ error: 'amount must be positive' }, { status: 400 })
    }

    const client = createAdminClient()
    const { data: fromAccount, error: fromError } = await client
      .from('bank_accounts')
      .select('id, current_balance, name')
      .eq('id', fromAccountId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fromError) throw fromError
    if (!fromAccount) return Response.json({ error: 'Source account not found' }, { status: 404 })
    if (Number(fromAccount.current_balance) < transferAmount) {
      return Response.json({ error: 'Insufficient balance in source account' }, { status: 400 })
    }

    const transferNo = await getNextSequence('BANK_TRANSFER', 'XFER-')
    const { data, error } = await client
      .from('bank_transfers')
      .insert({
        company_id: companyId,
        transfer_no: transferNo,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        date: new Date(date).toISOString(),
        amount: transferAmount,
        reference: reference ?? null,
      })
      .select('*')
      .single()

    if (error) throw error

    const now = new Date().toISOString()
    await client.from('bank_accounts').update({
      current_balance: Number(fromAccount.current_balance) - transferAmount,
      updated_at: now,
    }).eq('id', fromAccountId).eq('company_id', companyId)

    const { data: toAccount, error: toError } = await client
      .from('bank_accounts')
      .select('current_balance')
      .eq('id', toAccountId)
      .eq('company_id', companyId)
      .single()

    if (toError) throw toError

    await client.from('bank_accounts').update({
      current_balance: Number(toAccount.current_balance) + transferAmount,
      updated_at: now,
    }).eq('id', toAccountId).eq('company_id', companyId)

    await client.from('bank_transactions').insert([
      {
        company_id: companyId,
        bank_account_id: fromAccountId,
        transaction_date: new Date(date).toISOString(),
        description: `Transfer to account (${transferNo})`,
        reference: reference ?? transferNo,
        amount: transferAmount,
        type: 'DEBIT',
        status: 'MATCHED',
      },
      {
        company_id: companyId,
        bank_account_id: toAccountId,
        transaction_date: new Date(date).toISOString(),
        description: `Transfer from account (${transferNo})`,
        reference: reference ?? transferNo,
        amount: transferAmount,
        type: 'CREDIT',
        status: 'MATCHED',
      },
    ])

    return Response.json(toCamel(data), { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
