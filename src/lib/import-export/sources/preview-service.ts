export type PreviewStage =
  | 'request_received'
  | 'authentication'
  | 'company_resolution'
  | 'provider_lookup'
  | 'connection_lookup'
  | 'checkpoint_lookup'
  | 'module_resolution'
  | 'adapter_initialization'
  | 'preview_generation'
  | 'quickbooks_request'
  | 'preview_response'

export type PreviewStageState = 'started' | 'completed' | 'failed'

export interface PreviewStructuredError {
  stage: PreviewStage
  module: string | null
  errorCode: string
  message: string
  correlationId: string
}

export class PreviewStageError extends Error {
  constructor(
    readonly stage: PreviewStage,
    readonly errorCode: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PreviewStageError'
  }
}

export interface PreviewResourceDescriptor {
  key: string
  label: string
  moduleKey: string
}

export type IsolatedPreviewResult<T> =
  | (T & { status: 'success' })
  | (PreviewResourceDescriptor & PreviewStructuredError & { status: 'error' | 'unsupported' })

interface IsolatedPreviewDependencies<T> {
  requested: string[]
  resources: PreviewResourceDescriptor[]
  correlationId: string
  resolveModule: (moduleKey: string) => unknown
  isSupported: (resourceKey: string) => { supported: boolean; message?: string }
  generate: (resource: PreviewResourceDescriptor, definition: unknown) => Promise<T>
  onStage?: (stage: PreviewStage, state: PreviewStageState, module: string) => void
}

export async function generateIsolatedPreviews<T extends PreviewResourceDescriptor>(
  dependencies: IsolatedPreviewDependencies<T>,
): Promise<Array<IsolatedPreviewResult<T>>> {
  const results: Array<IsolatedPreviewResult<T>> = []

  for (const requestedKey of dependencies.requested) {
    const resource = dependencies.resources.find((candidate) => candidate.key === requestedKey)
    if (!resource) {
      results.push({
        key: requestedKey,
        label: requestedKey,
        moduleKey: requestedKey,
        status: 'error',
        ...previewError('adapter_initialization', requestedKey, 'ADAPTER_RESOURCE_MISSING', `No source adapter resource is registered for ${requestedKey}.`, dependencies.correlationId),
      })
      continue
    }

    const support = dependencies.isSupported(resource.key)
    if (!support.supported) {
      results.push({
        ...resource,
        status: 'unsupported',
        ...previewError('adapter_initialization', resource.key, 'MODULE_UNSUPPORTED', support.message ?? `${resource.label} is not supported by this source adapter.`, dependencies.correlationId),
      })
      continue
    }

    let definition: unknown
    dependencies.onStage?.('module_resolution', 'started', resource.key)
    try {
      definition = dependencies.resolveModule(resource.moduleKey)
      dependencies.onStage?.('module_resolution', 'completed', resource.key)
    } catch (error) {
      dependencies.onStage?.('module_resolution', 'failed', resource.key)
      results.push({
        ...resource,
        status: 'error',
        ...toPreviewError(error, 'module_resolution', resource.key, 'MODULE_NOT_REGISTERED', dependencies.correlationId),
      })
      continue
    }

    dependencies.onStage?.('preview_generation', 'started', resource.key)
    try {
      const preview = await dependencies.generate(resource, definition)
      dependencies.onStage?.('preview_generation', 'completed', resource.key)
      results.push({ ...preview, status: 'success' })
    } catch (error) {
      dependencies.onStage?.('preview_generation', 'failed', resource.key)
      results.push({
        ...resource,
        status: 'error',
        ...toPreviewError(error, 'preview_generation', resource.key, 'PREVIEW_GENERATION_FAILED', dependencies.correlationId),
      })
    }
  }

  return results
}

export function toPreviewError(
  error: unknown,
  fallbackStage: PreviewStage,
  module: string | null,
  fallbackCode: string,
  correlationId: string,
): PreviewStructuredError {
  if (error instanceof PreviewStageError) {
    return previewError(error.stage, module, error.errorCode, error.message, correlationId)
  }
  const record = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : 'Request failed.'
  const code = typeof record.code === 'string' ? record.code : fallbackCode
  return previewError(fallbackStage, module, code, message, correlationId)
}

function previewError(
  stage: PreviewStage,
  module: string | null,
  errorCode: string,
  message: string,
  correlationId: string,
): PreviewStructuredError {
  return { stage, module, errorCode, message, correlationId }
}
