import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { apiError } from '@/lib/import-export/api-helpers'
import {
  getQuickBooksMigrationSession,
  updateQuickBooksMigrationSession,
} from '@/lib/import-export/wizard/migration-session.service'
import type { DuplicateStrategy } from '@/lib/import-export/types'
import type { ModuleLifecycleState, SelectableResource } from '@/lib/import-export/wizard/module-lifecycle'
import type { MigrationSessionState, MigrationSessionStep } from '@/lib/import-export/wizard/migration-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAccountingAdmin()
    const { sessionId } = await params
    const session = await getQuickBooksMigrationSession(sessionId)
    if (!session) return Response.json({ error: 'Migration session not found' }, { status: 404 })
    return Response.json({ session }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAccountingAdmin()
    const { sessionId } = await params
    const body = await request.json() as {
      lifecycle?: ModuleLifecycleState
      selectedModules?: SelectableResource[]
      duplicateStrategy?: DuplicateStrategy
      step?: MigrationSessionStep
      state?: MigrationSessionState
    }

    const session = await updateQuickBooksMigrationSession({
      sessionId,
      lifecycle: body.lifecycle,
      selectedModules: body.selectedModules,
      duplicateStrategy: body.duplicateStrategy,
      step: body.step,
      state: body.state,
    })

    return Response.json({ session })
  } catch (error) {
    return apiError(error)
  }
}
