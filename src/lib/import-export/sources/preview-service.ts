import type { ExternalRequestEvent } from '@/lib/ops/external-request-diagnostics'

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
  concurrency?: number
}

interface PreviewModuleProfile {
  module: string
  durationMs: number
  quickBooksApiCalls: number
  quickBooksDurationMs: number
  supabaseQueries: number
  supabaseDurationMs: number
  rowsFetched: number
  sourceCount: number
}

export interface PreviewProfile {
  durationMs: number
  quickBooksApiCalls: number
  supabaseQueries: number
  externalCalls: number
  concurrency: number
  sampleSize: number
  duplicateDetection: 'deferred'
  stages: Array<{ stage: PreviewStage; module: string | null; durationMs: number }>
  modules: PreviewModuleProfile[]
  repeatedRequests: Array<{ kind: string; endpoint: string; signature: string; count: number }>
  nPlusOneCandidates: Array<{ module: string; supabaseQueries: number }>
}

export class PreviewProfiler {
  private readonly startedAt = performance.now()
  private readonly moduleStarted = new Map<string, number>()
  private readonly moduleDurations = new Map<string, number>()
  private readonly stageStarted = new Map<string, number>()
  private readonly stageDurations = new Map<string, { stage: PreviewStage; module: string | null; durationMs: number }>()
  private readonly requests: ExternalRequestEvent[] = []
  private readonly resultSizes = new Map<string, { rowsFetched: number; sourceCount: number }>()

  constructor(readonly concurrency: number, readonly sampleSize: number) {}

  stage(stage: PreviewStage, state: PreviewStageState, module: string | null) {
    const key = `${stage}:${module ?? 'request'}`
    if (state === 'started') this.stageStarted.set(key, performance.now())
    else {
      const stageStarted = this.stageStarted.get(key)
      if (stageStarted !== undefined) {
        const previous = this.stageDurations.get(key)?.durationMs ?? 0
        this.stageDurations.set(key, { stage, module, durationMs: previous + performance.now() - stageStarted })
        this.stageStarted.delete(key)
      }
    }
    if (!module || stage !== 'preview_generation') return
    if (state === 'started') this.moduleStarted.set(module, performance.now())
    else {
      const started = this.moduleStarted.get(module)
      if (started !== undefined) this.moduleDurations.set(module, performance.now() - started)
    }
  }

  request = (event: ExternalRequestEvent) => {
    this.requests.push(event)
  }

  result(module: string, rowsFetched: number, sourceCount: number) {
    this.resultSizes.set(module, { rowsFetched, sourceCount })
  }

  report(): PreviewProfile {
    const modules = [...new Set([
      ...this.moduleDurations.keys(),
      ...this.requests.flatMap((request) => request.module ? [request.module] : []),
      ...this.resultSizes.keys(),
    ])].map((module) => {
      const requests = this.requests.filter((request) => request.module === module)
      const sizes = this.resultSizes.get(module)
      return {
        module,
        durationMs: Math.round(this.moduleDurations.get(module) ?? 0),
        quickBooksApiCalls: requests.filter((request) => request.kind === 'quickbooks').length,
        quickBooksDurationMs: Math.round(requests.filter((request) => request.kind === 'quickbooks').reduce((sum, request) => sum + request.durationMs, 0)),
        supabaseQueries: requests.filter((request) => request.kind === 'supabase').length,
        supabaseDurationMs: Math.round(requests.filter((request) => request.kind === 'supabase').reduce((sum, request) => sum + request.durationMs, 0)),
        rowsFetched: sizes?.rowsFetched ?? 0,
        sourceCount: sizes?.sourceCount ?? 0,
      }
    })
    const repeated = new Map<string, { kind: string; endpoint: string; signature: string; count: number }>()
    for (const request of this.requests) {
      const key = `${request.kind}:${request.signature}`
      const existing = repeated.get(key)
      if (existing) existing.count += 1
      else repeated.set(key, { kind: request.kind, endpoint: request.endpoint, signature: request.signature, count: 1 })
    }
    return {
      durationMs: Math.round(performance.now() - this.startedAt),
      quickBooksApiCalls: this.requests.filter((request) => request.kind === 'quickbooks').length,
      supabaseQueries: this.requests.filter((request) => request.kind === 'supabase').length,
      externalCalls: this.requests.filter((request) => request.kind === 'external').length,
      concurrency: this.concurrency,
      sampleSize: this.sampleSize,
      duplicateDetection: 'deferred',
      stages: [...this.stageDurations.values()].map((entry) => ({ ...entry, durationMs: Math.round(entry.durationMs) })),
      modules,
      repeatedRequests: [...repeated.values()].filter((request) => request.count > 1),
      nPlusOneCandidates: modules.filter((module) => module.supabaseQueries > 2).map(({ module, supabaseQueries }) => ({ module, supabaseQueries })),
    }
  }
}

export async function generateIsolatedPreviews<T extends PreviewResourceDescriptor>(
  dependencies: IsolatedPreviewDependencies<T>,
): Promise<Array<IsolatedPreviewResult<T>>> {
  const results = new Array<IsolatedPreviewResult<T>>(dependencies.requested.length)
  const concurrency = Math.min(5, Math.max(1, dependencies.concurrency ?? 3))
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < dependencies.requested.length) {
      const index = nextIndex++
      const requestedKey = dependencies.requested[index]
      const resource = dependencies.resources.find((candidate) => candidate.key === requestedKey)
      if (!resource) {
        results[index] = {
          key: requestedKey,
          label: requestedKey,
          moduleKey: requestedKey,
          status: 'error',
          ...previewError('adapter_initialization', requestedKey, 'ADAPTER_RESOURCE_MISSING', `No source adapter resource is registered for ${requestedKey}.`, dependencies.correlationId),
        }
        continue
      }

      const support = dependencies.isSupported(resource.key)
      if (!support.supported) {
        results[index] = {
          ...resource,
          status: 'unsupported',
          ...previewError('adapter_initialization', resource.key, 'MODULE_UNSUPPORTED', support.message ?? `${resource.label} is not supported by this source adapter.`, dependencies.correlationId),
        }
        continue
      }

      let definition: unknown
      dependencies.onStage?.('module_resolution', 'started', resource.key)
      try {
        definition = dependencies.resolveModule(resource.moduleKey)
        dependencies.onStage?.('module_resolution', 'completed', resource.key)
      } catch (error) {
        dependencies.onStage?.('module_resolution', 'failed', resource.key)
        results[index] = {
          ...resource,
          status: 'error',
          ...toPreviewError(error, 'module_resolution', resource.key, 'MODULE_NOT_REGISTERED', dependencies.correlationId),
        }
        continue
      }

      dependencies.onStage?.('preview_generation', 'started', resource.key)
      try {
        const preview = await dependencies.generate(resource, definition)
        dependencies.onStage?.('preview_generation', 'completed', resource.key)
        results[index] = { ...preview, status: 'success' }
      } catch (error) {
        dependencies.onStage?.('preview_generation', 'failed', resource.key)
        results[index] = {
          ...resource,
          status: 'error',
          ...toPreviewError(error, 'preview_generation', resource.key, 'PREVIEW_GENERATION_FAILED', dependencies.correlationId),
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, dependencies.requested.length) }, () => worker()))

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
