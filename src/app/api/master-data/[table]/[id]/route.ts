import { requireAuth } from '@/lib/auth'
import { updateMasterRecord, deleteMasterRecord } from '@/lib/master-data/repository'

const VALID_TABLES = new Set(['units_of_measure', 'warehouses', 'payment_terms', 'departments', 'company_currencies'])

export async function PUT(request: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  try {
    await requireAuth()
    const { table, id } = await params
    if (!VALID_TABLES.has(table)) {
      return Response.json({ error: 'Invalid master table' }, { status: 400 })
    }
    const body = await request.json()
    const row = await updateMasterRecord(table as 'units_of_measure', id, body)
    return Response.json(row)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  try {
    await requireAuth()
    const { table, id } = await params
    if (!VALID_TABLES.has(table)) {
      return Response.json({ error: 'Invalid master table' }, { status: 400 })
    }
    await deleteMasterRecord(table as 'units_of_measure', id)
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
