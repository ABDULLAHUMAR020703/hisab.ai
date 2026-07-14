import { requireAuth } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/tenant'
import { buildTrialBalance } from '@/lib/accounting/trial-balance'
import { buildReportCacheKey, getCachedReport, setCachedReport } from '@/lib/accounting/report-cache'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') ? new Date(searchParams.get('asOf')!) : new Date()
    const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : undefined
    const to = searchParams.get('to') ? new Date(searchParams.get('to')!) : undefined

    const cacheKey = buildReportCacheKey('trial-balance', companyId, {
      asOf: asOf.toISOString(),
      from: from?.toISOString(),
      to: to?.toISOString(),
    })
    const cached = getCachedReport<ReturnType<typeof buildTrialBalance>>(cacheKey)
    if (cached) return Response.json(cached)

    const report = await buildTrialBalance({ asOf, from, to, companyId })
    setCachedReport(cacheKey, report)

    return Response.json(report)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
