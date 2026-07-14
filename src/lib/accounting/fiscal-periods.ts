import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import type { FiscalPeriodRecord } from './types'

function mapPeriod(row: Record<string, unknown>): FiscalPeriodRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    name: String(row.name),
    periodStart: new Date(String(row.period_start)),
    periodEnd: new Date(String(row.period_end)),
    status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
    closedById: (row.closed_by_id as string | null) ?? null,
  }
}

export async function listFiscalPeriods(companyId?: string): Promise<FiscalPeriodRecord[]> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('fiscal_periods')
    .select('*')
    .eq('company_id', cid)
    .order('period_start', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapPeriod)
}

export async function closeFiscalPeriod(
  periodId: string,
  closedById: string,
  companyId?: string,
): Promise<FiscalPeriodRecord> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('fiscal_periods')
    .update({
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      closed_by_id: closedById,
    })
    .eq('id', periodId)
    .eq('company_id', cid)
    .select('*')
    .single()

  if (error) throw error
  return mapPeriod(data)
}

export async function ensureCurrentFiscalPeriod(companyId: string): Promise<void> {
  const client = createAdminClient()
  const year = new Date().getFullYear()
  const periodStart = new Date(year, 0, 1)
  const periodEnd = new Date(year, 11, 31, 23, 59, 59)

  const { data: existing } = await client
    .from('fiscal_periods')
    .select('id')
    .eq('company_id', companyId)
    .gte('period_start', periodStart.toISOString())
    .lte('period_end', periodEnd.toISOString())
    .limit(1)

  if (existing && existing.length > 0) return

  await client.from('fiscal_periods').insert({
    company_id: companyId,
    name: `${year} Fiscal Year`,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    status: 'OPEN',
  })
}
