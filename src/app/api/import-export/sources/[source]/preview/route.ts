import { requireAuth } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/tenant'
import { apiError } from '@/lib/import-export/api-helpers'
import { detectDuplicates } from '@/lib/import-export/duplicate/duplicate-detector'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import { getImportSource, fetchSourceResources } from '@/lib/import-export/sources/source-registry'
import { coerceMappedRows, validateMappedRows } from '@/lib/import-export/validation/validation-engine'
import type { MappedRow } from '@/lib/import-export/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  try {
    const user = await requireAuth()
    const tenantId = await resolveCompanyId()
    const { source: sourceKey } = await params
    const source = getImportSource(sourceKey)
    const body = await request.json() as { resources?: unknown }
    const requested = Array.isArray(body.resources)
      ? [...new Set(body.resources.filter((item): item is string => typeof item === 'string'))]
      : []
    const allowed = new Set(source.resources.map((resource) => resource.key))
    if (requested.length === 0 || requested.length > source.resources.length || requested.some((key) => !allowed.has(key))) {
      return Response.json({ error: 'Select one or more valid import resources.' }, { status: 400 })
    }

    const normalized = await fetchSourceResources(tenantId, sourceKey, requested)
    const resources = []
    for (const resource of normalized) {
      const moduleDefinition = getModuleDefinition(resource.moduleKey)
      const mappedRows: MappedRow[] = resource.rows.map((row, index) => ({
        rowNumber: index + 2,
        source: row,
        mapped: row,
      }))
      const coerced = coerceMappedRows(mappedRows, moduleDefinition.fields)
      const validation = validateMappedRows(coerced, moduleDefinition.fields)
      const validRows = coerced.filter((row) => validation.validRowNumbers.includes(row.rowNumber))
      const duplicates = await detectDuplicates(moduleDefinition, validRows, { companyId: tenantId, userId: user.id })
      const headers = moduleDefinition.fields.filter((field) => field.importable !== false).map((field) => field.key)
      resources.push({
        ...resource,
        count: resource.rows.length,
        headers,
        mapping: Object.fromEntries(headers.map((header) => [header, header])),
        validation,
        duplicates,
        sampleRows: resource.rows.slice(0, 10),
      })
    }

    return Response.json({ source: { key: source.key, label: source.label }, resources })
  } catch (error) {
    return apiError(error)
  }
}
