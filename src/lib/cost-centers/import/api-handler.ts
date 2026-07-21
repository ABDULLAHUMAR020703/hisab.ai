import { requireAuth } from '@/lib/auth'
import { importCostCentersFromBuffer } from '@/lib/cost-centers/import/service'
import { parseCsvTextAsBuffer } from '@/lib/cost-centers/import/parsers'
import type { CostCenterImportKind } from '@/lib/cost-centers/import/parsers'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export async function handleCostCenterTypedImport(
  request: Request,
  kind: CostCenterImportKind,
) {
  try {
    await requireAuth()
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return Response.json({ error: 'file is required' }, { status: 400 })
    }
    if (file.size <= 0) {
      return Response.json({ error: 'File is empty' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'File exceeds 10 MB limit' }, { status: 400 })
    }

    let buffer = await file.arrayBuffer()
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(buffer)
      buffer = parseCsvTextAsBuffer(text)
    }

    const summary = await importCostCentersFromBuffer(kind, buffer)
    return Response.json(summary, { status: 200 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
