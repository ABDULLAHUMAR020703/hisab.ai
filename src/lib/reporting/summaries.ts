import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export async function refreshDailySummaries(options?: { from?: Date; to?: Date; companyId?: string }) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const to = options?.to ?? new Date()
  const from = options?.from ?? new Date(to.getFullYear(), to.getMonth(), 1)

  const { data: entries, error } = await client
    .from('ledger_entries')
    .select('entry_date, account_id, cost_center_id, debit, credit, account:chart_of_accounts(canonical_type)')
    .eq('company_id', companyId)
    .gte('entry_date', from.toISOString())
    .lte('entry_date', to.toISOString())

  if (error) throw error

  const buckets = new Map<string, {
    summary_date: string
    canonical_type: string
    account_id: string
    cost_center_id: string | null
    total_debit: number
    total_credit: number
    entry_count: number
  }>()

  for (const row of entries ?? []) {
    const date = String(row.entry_date).substring(0, 10)
    const accountId = String(row.account_id)
    const costCenterId = row.cost_center_id ? String(row.cost_center_id) : null
    const canonicalType = String((row.account as { canonical_type?: string } | null)?.canonical_type ?? 'Asset')
    const key = `${date}|${canonicalType}|${accountId}|${costCenterId ?? ''}`
    const bucket = buckets.get(key) ?? {
      summary_date: date,
      canonical_type: canonicalType,
      account_id: accountId,
      cost_center_id: costCenterId,
      total_debit: 0,
      total_credit: 0,
      entry_count: 0,
    }
    bucket.total_debit += Number(row.debit ?? 0)
    bucket.total_credit += Number(row.credit ?? 0)
    bucket.entry_count += 1
    buckets.set(key, bucket)
  }

  const rows = [...buckets.values()].map((b) => ({
    company_id: companyId,
    summary_date: b.summary_date,
    canonical_type: b.canonical_type,
    account_id: b.account_id,
    cost_center_id: b.cost_center_id,
    department_id: null,
    total_debit: b.total_debit,
    total_credit: b.total_credit,
    entry_count: b.entry_count,
    refreshed_at: new Date().toISOString(),
  }))

  if (rows.length > 0) {
    const { error: upsertError } = await client
      .from('report_daily_summaries')
      .upsert(rows, { onConflict: 'company_id,summary_date,canonical_type,account_id,cost_center_id,department_id' })
    if (upsertError) throw upsertError
  }

  return { refreshed: rows.length, from: from.toISOString(), to: to.toISOString() }
}
