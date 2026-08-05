import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { apiError } from '@/lib/import-export/api-helpers'
import {
  createQuickBooksMigrationSession,
  findActiveQuickBooksMigrationSession,
  findLatestQuickBooksMigrationSession,
  listQuickBooksMigrationSessions,
} from '@/lib/import-export/wizard/migration-session.service'
import type { DuplicateStrategy } from '@/lib/import-export/types'
import type { ModuleLifecycleState, SelectableResource } from '@/lib/import-export/wizard/module-lifecycle'
import type { MigrationSessionState } from '@/lib/import-export/wizard/migration-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Detect or list QuickBooks migration sessions. Never creates one. */
export async function GET(request: Request) {
  try {
    await requireAccountingAdmin()
    const url = new URL(request.url)
    if (url.searchParams.get('list') === 'true') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '25')
      const status = (url.searchParams.get('status') ?? '') as MigrationSessionState | ''
      const result = await listQuickBooksMigrationSessions({ page, limit, status })
      return Response.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })
    }
    const includeLatest = url.searchParams.get('includeLatest') === 'true'
    const session = includeLatest
      ? await findLatestQuickBooksMigrationSession()
      : await findActiveQuickBooksMigrationSession()
    return Response.json({ session }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })
  } catch (error) {
    return apiError(error)
  }
}

/** Create a persistent QuickBooks migration session. Rejects if one is already active. */
export async function POST(request: Request) {
  try {
    const user = await requireAccountingAdmin()
    const body = await request.json() as {
      selectedModules?: SelectableResource[]
      duplicateStrategy?: DuplicateStrategy
      lifecycle?: ModuleLifecycleState
      sourceLabel?: string | null
      companyName?: string | null
      currency?: string | null
    }

    const existing = await findActiveQuickBooksMigrationSession()
    if (existing) {
      return Response.json({
        error: 'Migration already running',
        code: 'MIGRATION_ALREADY_RUNNING',
        session: existing,
      }, { status: 409 })
    }

    if (!Array.isArray(body.selectedModules) || body.selectedModules.length === 0) {
      return Response.json({ error: 'selectedModules is required' }, { status: 400 })
    }
    if (!body.lifecycle || typeof body.lifecycle !== 'object') {
      return Response.json({ error: 'lifecycle is required' }, { status: 400 })
    }

    const session = await createQuickBooksMigrationSession({
      userId: user.id,
      selectedModules: body.selectedModules,
      duplicateStrategy: body.duplicateStrategy ?? 'skip',
      lifecycle: body.lifecycle,
      sourceLabel: body.sourceLabel,
      companyName: body.companyName,
      currency: body.currency,
    })

    return Response.json({ session }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
