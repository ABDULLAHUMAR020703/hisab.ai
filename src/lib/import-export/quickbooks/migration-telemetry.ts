import { randomUUID } from 'node:crypto'
import type { ExternalRequestEvent } from '@/lib/ops/external-request-diagnostics'
import { logger } from '@/lib/ops/logger'

export type MigrationStage = 'oauth' | 'provider_initialization' | 'module_scheduling' | 'extraction' | 'pagination' | 'staging_cleanup' | 'validation' | 'duplicate_detection' | 'materialization' | 'posting' | 'report_generation'

export interface MigrationModuleCounts {
  fetched?: number
  imported?: number
  updated?: number
  skipped?: number
  failed?: number
}

export interface MigrationTraceEvent {
  id: string
  at: string
  type: string
  message: string
  module?: string | null
  stage?: string | null
  batch?: number | null
  records?: number | null
}

export interface MigrationTraceSnapshot {
  currentModule: string
  currentStage: string | null
  currentBatch: number
  estimatedTotalRecords: number
  processedRecords: number
  throughput: number
  averageThroughput: number
  apiRequests: number
  databaseQueries: number
  databaseWrites: number
  retryCount: number
  memoryBytes: number
  startedAt: string
  stages: Record<string, { status: 'pending' | 'running' | 'completed' | 'failed'; durationMs?: number; progress?: number }>
}

export interface MigrationTraceOptions {
  onEvent?: (event: MigrationTraceEvent, snapshot: MigrationTraceSnapshot) => void
}

interface RequestAggregate {
  kind: ExternalRequestEvent['kind']
  endpoint: string
  signature: string
  calls: number
  failedCalls: number
  durationMs: number
  writes: number
}

export class MigrationTrace {
  readonly correlationId: string
  private readonly startedAt = performance.now()
  private readonly startedWallClock = new Date().toISOString()
  private readonly initialHeap = process.memoryUsage().heapUsed
  private peakHeap = this.initialHeap
  private readonly stages = new Map<string, { calls: number; durationMs: number; failed: number }>()
  private readonly requests = new Map<string, RequestAggregate>()
  private readonly events: MigrationTraceEvent[] = []
  private currentStage: string | null = null
  private processedRecords = 0
  private estimatedTotalRecords = 0
  private currentBatch = 0
  private readonly onEvent?: MigrationTraceOptions['onEvent']

  constructor(readonly module: string, correlationId?: string, options?: MigrationTraceOptions) {
    this.correlationId = correlationId || randomUUID()
    this.onEvent = options?.onEvent
  }

  async measure<T>(stage: MigrationStage, operation: () => Promise<T> | T): Promise<T> {
    const startedAt = performance.now()
    this.currentStage = stage
    this.emitEvent('stage_started', `Started ${stage.replaceAll('_', ' ')}`, { stage })
    logger.info('quickbooks.migration.stage.started', { correlationId:this.correlationId, module:this.module, stage })
    try {
      const result = await operation()
      this.recordStage(stage, performance.now() - startedAt, false)
      this.emitEvent('stage_completed', `Completed ${stage.replaceAll('_', ' ')}`, { stage })
      return result
    } catch (error) {
      this.recordStage(stage, performance.now() - startedAt, true)
      this.emitEvent('stage_failed', `Failed ${stage.replaceAll('_', ' ')}`, { stage })
      logger.error('quickbooks.migration.stage.failed', {
        correlationId:this.correlationId,
        module:this.module,
        stage,
        errorName:error instanceof Error ? error.name : 'Error',
        errorMessage:error instanceof Error ? error.message : String(error),
        errorCause:this.errorCause(error),
      })
      throw error
    }
  }

  page(records: number, extracted: number) {
    this.sampleHeap()
    this.currentBatch += 1
    this.processedRecords = extracted
    this.estimatedTotalRecords = Math.max(this.estimatedTotalRecords, extracted)
    this.emitEvent('batch_completed', `Completed batch ${this.currentBatch}`, { stage: 'extraction', batch: this.currentBatch, records })
    logger.info('quickbooks.migration.page', { correlationId:this.correlationId, module:this.module, records, extracted, heapUsedBytes:process.memoryUsage().heapUsed })
  }

  accumulate(stage: MigrationStage, durationMs: number, failed = false) {
    this.recordStage(stage,durationMs,failed,false)
  }

  request = (event: ExternalRequestEvent) => {
    const key = `${event.kind}:${event.signature}`
    const aggregate = this.requests.get(key) ?? { kind:event.kind, endpoint:event.endpoint, signature:event.signature, calls:0, failedCalls:0, durationMs:0, writes:0 }
    aggregate.calls += 1
    aggregate.durationMs += event.durationMs
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) aggregate.writes += 1
    if (event.status === null || event.status >= 400) aggregate.failedCalls += 1
    this.requests.set(key, aggregate)
    if (event.error) logger.warn('quickbooks.migration.network.failed', { correlationId:this.correlationId, module:this.module, kind:event.kind, endpoint:event.endpoint, attempt:event.attempt, ...event.error })
  }

  setTotals(processedRecords: number, estimatedTotalRecords: number) {
    this.processedRecords = Math.max(this.processedRecords, processedRecords)
    this.estimatedTotalRecords = Math.max(this.estimatedTotalRecords, estimatedTotalRecords)
  }

  snapshot(): MigrationTraceSnapshot {
    const elapsedMs = Math.max(1, performance.now() - this.startedAt)
    const apiRequests = [...this.requests.values()].filter(item => item.kind === 'quickbooks').reduce((sum, item) => sum + item.calls, 0)
    const databaseQueries = [...this.requests.values()].filter(item => item.kind === 'supabase').reduce((sum, item) => sum + item.calls, 0)
    const averageThroughput = this.processedRecords / (elapsedMs / 1000)
    return {
      currentModule: this.module,
      currentStage: this.currentStage,
      currentBatch: this.currentBatch,
      estimatedTotalRecords: this.estimatedTotalRecords,
      processedRecords: this.processedRecords,
      throughput: averageThroughput,
      averageThroughput,
      apiRequests,
      databaseQueries,
      retryCount: [...this.requests.values()].reduce((sum, item) => sum + Math.max(0, item.calls - 1), 0),
      memoryBytes: process.memoryUsage().heapUsed,
      startedAt: this.startedWallClock,
      databaseWrites: [...this.requests.values()].filter(item => item.kind === 'supabase').reduce((sum, item) => sum + item.writes, 0),
      stages: Object.fromEntries([
        ...[...this.stages.entries()].map(([stage, value]) => [stage, { status: value.failed ? 'failed' as const : 'completed' as const, durationMs: value.durationMs }] as const),
        ...(this.currentStage && !this.stages.has(this.currentStage) ? [[this.currentStage, { status: 'running' as const, progress: 35 }] as const] : []),
      ]),
    }
  }

  private emitEvent(type: string, message: string, meta: Partial<MigrationTraceEvent> = {}) {
    const event: MigrationTraceEvent = { id: randomUUID(), at: new Date().toISOString(), type, message, module: this.module, ...meta }
    this.events.push(event)
    this.onEvent?.(event, this.snapshot())
  }

  finish(counts: MigrationModuleCounts = {}) {
    this.sampleHeap()
    const requestList = [...this.requests.values()]
    const profile = {
      correlationId:this.correlationId,
      module:this.module,
      durationMs:Math.round(performance.now() - this.startedAt),
      ...counts,
      quickBooksApiCalls:requestList.filter(item => item.kind === 'quickbooks').reduce((sum,item)=>sum+item.calls,0),
      supabaseQueries:requestList.filter(item => item.kind === 'supabase').reduce((sum,item)=>sum+item.calls,0),
      failedNetworkCalls:requestList.reduce((sum,item)=>sum+item.failedCalls,0),
      heapStartBytes:this.initialHeap,
      heapPeakBytes:this.peakHeap,
      heapFinishBytes:process.memoryUsage().heapUsed,
      stages:Object.fromEntries(this.stages),
      repeatedRequests:requestList.filter(item=>item.calls>1),
    }
    logger.info('quickbooks.migration.module.finished', profile)
    return profile
  }

  private recordStage(stage: MigrationStage, durationMs: number, failed: boolean, emitLog = true) {
    this.sampleHeap()
    const current = this.stages.get(stage) ?? { calls:0, durationMs:0, failed:0 }
    current.calls += 1
    current.durationMs += Math.round(durationMs)
    if (failed) current.failed += 1
    this.stages.set(stage,current)
    if (emitLog) logger.info('quickbooks.migration.stage.finished', { correlationId:this.correlationId, module:this.module, stage, durationMs:Math.round(durationMs), failed, heapUsedBytes:process.memoryUsage().heapUsed })
  }

  private sampleHeap() {
    this.peakHeap = Math.max(this.peakHeap, process.memoryUsage().heapUsed)
  }

  private errorCause(error: unknown): string | null {
    const current=error !== null && typeof error==='object' ? error as Record<string,unknown> : {}
    const cause=current.cause !== null && typeof current.cause==='object' ? current.cause as Record<string,unknown> : {}
    return typeof cause.code==='string' ? cause.code : typeof current.code==='string' ? current.code : null
  }
}
