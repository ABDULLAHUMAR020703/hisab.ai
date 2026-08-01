import { requireAuth } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/tenant'
import { detectDuplicates } from '@/lib/import-export/duplicate/duplicate-detector'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import { getImportSource, fetchSourceResource } from '@/lib/import-export/sources/source-registry'
import { getQuickBooksPreviewSupport } from '@/lib/import-export/sources/quickbooks.adapter'
import {
  generateIsolatedPreviews,
  toPreviewError,
  type PreviewStage,
  type PreviewStageState,
} from '@/lib/import-export/sources/preview-service'
import { coerceMappedRows, validateMappedRows } from '@/lib/import-export/validation/validation-engine'
import type { MappedRow, ModuleDefinition } from '@/lib/import-export/types'
import { CORRELATION_HEADER, getCorrelationId } from '@/lib/ops/correlation'
import { logger } from '@/lib/ops/logger'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const correlationId = getCorrelationId(request)
  let currentStage: PreviewStage = 'request_received'
  let sourceKey = 'unknown'
  const trace = (stage: PreviewStage, state: PreviewStageState, module: string | null = null) => {
    currentStage = stage
    const context = { correlationId, route: 'POST /api/import-export/sources/[source]/preview', stage, state, module, source: sourceKey }
    if (state === 'failed') logger.error('quickbooks.preview.stage', context)
    else logger.info('quickbooks.preview.stage', context)
  }

  trace('request_received', 'started')
  try {
    trace('authentication', 'started')
    const user = await requireAuth()
    trace('authentication', 'completed')
    trace('company_resolution', 'started')
    const tenantId = await resolveCompanyId()
    trace('company_resolution', 'completed')
    sourceKey = (await params).source
    trace('adapter_initialization', 'started')
    const source = getImportSource(sourceKey)
    trace('adapter_initialization', 'completed')
    const body = await request.json() as { resources?: unknown }
    const requested = Array.isArray(body.resources)
      ? [...new Set(body.resources.filter((item): item is string => typeof item === 'string'))]
      : []
    if (requested.length === 0 || requested.length > 100) {
      const error = toPreviewError(new Error('Select one or more valid import resources.'), 'request_received', null, 'INVALID_RESOURCE_SELECTION', correlationId)
      trace('request_received', 'failed')
      return Response.json(error, { status: 400, headers: { [CORRELATION_HEADER]: correlationId } })
    }

    const resources = await generateIsolatedPreviews({
      requested,
      resources: source.resources,
      correlationId,
      resolveModule: (moduleKey) => getModuleDefinition(moduleKey),
      isSupported: (resourceKey) => sourceKey === 'quickbooks' ? getQuickBooksPreviewSupport(resourceKey) : { supported: true },
      onStage: trace,
      generate: async (resource, definition) => {
        const normalized = await fetchSourceResource(tenantId, sourceKey, resource.key, { preview: true, onStage: trace })
        const moduleDefinition = definition as ModuleDefinition
        const mappedRows: MappedRow[] = normalized.rows.map((row, index) => ({
          rowNumber: index + 2,
          source: row,
          mapped: row,
        }))
        const coerced = coerceMappedRows(mappedRows, moduleDefinition.fields)
        const validation = validateMappedRows(coerced, moduleDefinition.fields)
        const validRows = coerced.filter((row) => validation.validRowNumbers.includes(row.rowNumber))
        const duplicates = await detectDuplicates(moduleDefinition, validRows, { companyId: tenantId, userId: user.id })
        const headers = moduleDefinition.fields.filter((field) => field.importable !== false).map((field) => field.key)
        return {
          ...normalized,
          count: normalized.rows.length,
          headers,
          mapping: Object.fromEntries(headers.map((header) => [header, header])),
          validation,
          duplicates,
          sampleRows: normalized.rows.slice(0, 10),
        }
      },
    })

    trace('preview_response', 'completed')
    return Response.json({ source: { key: source.key, label: source.label }, resources, correlationId }, {
      headers: { [CORRELATION_HEADER]: correlationId },
    })
  } catch (error) {
    const structured = toPreviewError(error, currentStage, null, 'PREVIEW_REQUEST_FAILED', correlationId)
    trace(structured.stage, 'failed', structured.module)
    logger.error('quickbooks.preview.failed', {
      route: 'POST /api/import-export/sources/[source]/preview',
      ...structured,
      errorName: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    })
    const status = structured.stage === 'authentication' ? 401
      : structured.stage === 'request_received' ? 400
        : structured.stage === 'company_resolution' ? 403
          : 500
    return Response.json(structured, { status, headers: { [CORRELATION_HEADER]: correlationId } })
  }
}
