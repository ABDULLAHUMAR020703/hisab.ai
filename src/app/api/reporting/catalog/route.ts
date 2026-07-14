import { requireAuth } from '@/lib/auth'
import { listReportCatalog } from '@/lib/reporting/registry'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') ?? undefined
    return Response.json({ reports: listReportCatalog(category ?? undefined) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
