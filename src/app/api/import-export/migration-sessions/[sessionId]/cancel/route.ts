import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { apiError } from '@/lib/import-export/api-helpers'
import { cancelQuickBooksMigrationSession } from '@/lib/import-export/wizard/migration-session.service'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAccountingAdmin()
    const { sessionId } = await params
    const session = await cancelQuickBooksMigrationSession(sessionId)
    return Response.json({ session })
  } catch (error) {
    return apiError(error)
  }
}
