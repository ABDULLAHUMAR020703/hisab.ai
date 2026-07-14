import { requireAuth } from '@/lib/auth'
import { toCamel } from '@/lib/api/db-transform'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

async function adjustAccountBalance(
  client: ReturnType<typeof createAdminClient>,
  companyId: string,
  accountId: string,
  delta: number,
) {
  const { data: account, error } = await client
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', accountId)
    .eq('company_id', companyId)
    .single()

  if (error) throw error

  const { error: updateError } = await client
    .from('bank_accounts')
    .update({
      current_balance: Number(account.current_balance) + delta,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('company_id', companyId)

  if (updateError) throw updateError
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { searchParams } = new URL(request.url)
    const bankAccountId = searchParams.get('bankAccountId') ?? ''
    const status = searchParams.get('status') ?? ''
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const client = createAdminClient()

    let query = client
      .from('bank_transactions')
      .select('*, bank_account:bank_accounts(name, currency)')
      .eq('company_id', companyId)
      .order('transaction_date', { ascending: false })

    if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
    if (status) query = query.eq('status', status)
    if (dateFrom) query = query.gte('transaction_date', new Date(dateFrom).toISOString())
    if (dateTo) query = query.lte('transaction_date', new Date(dateTo).toISOString())

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
    const {
      bankAccountId, transactionDate, description, reference,
      amount, type, status, paymentId,
    } = body

    if (!bankAccountId || !transactionDate || !description || amount === undefined) {
      return Response.json({ error: 'bankAccountId, transactionDate, description, amount are required' }, { status: 400 })
    }

    const txnType = type ?? 'DEBIT'
    const txnAmount = Math.abs(Number(amount))
    const client = createAdminClient()

    const { data, error } = await client
      .from('bank_transactions')
      .insert({
        company_id: companyId,
        bank_account_id: bankAccountId,
        transaction_date: new Date(transactionDate).toISOString(),
        description,
        reference: reference ?? null,
        amount: txnAmount,
        type: txnType,
        status: status ?? 'UNMATCHED',
        payment_id: paymentId ?? null,
        imported_from: null,
      })
      .select('*, bank_account:bank_accounts(name, currency)')
      .single()

    if (error) throw error

    const balanceDelta = txnType === 'CREDIT' ? txnAmount : -txnAmount
    await adjustAccountBalance(client, companyId, bankAccountId, balanceDelta)

    return Response.json(toCamel(data), { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
