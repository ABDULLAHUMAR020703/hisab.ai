import { requireAuth } from '@/lib/auth'
import { getDashboardRepository } from '@/lib/db/provider'

export async function GET() {
  try {
    await requireAuth()
    const data = await getDashboardRepository().getStats()
    return Response.json(data)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Dashboard error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
