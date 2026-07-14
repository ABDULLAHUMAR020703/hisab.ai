import { requireAuth } from '@/lib/auth'
import { buildBalanceSheetFromLedger } from '@/lib/accounting/trial-balance'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') ? new Date(searchParams.get('asOf')!) : new Date()

    const report = await buildBalanceSheetFromLedger({ asOf })

    return Response.json(report)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
