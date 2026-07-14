import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { runReport } from './runner'
import type { ReportRunRequest } from './types'

export async function runCustomDefinition(definitionId: string, overrides: Partial<ReportRunRequest> = {}) {
  const companyId = overrides.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data, error } = await client
    .from('report_definitions')
    .select('*')
    .eq('id', definitionId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .single()

  if (error || !data) throw new Error('Report definition not found')

  const request: ReportRunRequest = {
    reportKey: String(data.base_report_key),
    companyId,
    period: overrides.period,
    asOf: overrides.asOf,
    filters: (data.filters as ReportRunRequest['filters']) ?? [],
    columns: (data.columns as string[]) ?? undefined,
    grouping: (data.grouping as ReportRunRequest['grouping']) ?? [],
    sorting: (data.sorting as ReportRunRequest['sorting']) ?? [],
    page: overrides.page,
    pageSize: overrides.pageSize,
    comparePeriod: overrides.comparePeriod,
    definitionId,
    ...overrides,
  }

  return runReport(request)
}
