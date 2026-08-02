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

interface RequestAggregate {
  kind: ExternalRequestEvent['kind']
  endpoint: string
  signature: string
  calls: number
  failedCalls: number
  durationMs: number
}

export class MigrationTrace {
  readonly correlationId: string
  private readonly startedAt = performance.now()
  private readonly initialHeap = process.memoryUsage().heapUsed
  private peakHeap = this.initialHeap
  private readonly stages = new Map<string, { calls: number; durationMs: number; failed: number }>()
  private readonly requests = new Map<string, RequestAggregate>()

  constructor(readonly module: string, correlationId?: string) {
    this.correlationId = correlationId || randomUUID()
  }

  async measure<T>(stage: MigrationStage, operation: () => Promise<T> | T): Promise<T> {
    const startedAt = performance.now()
    logger.info('quickbooks.migration.stage.started', { correlationId:this.correlationId, module:this.module, stage })
    try {
      const result = await operation()
      this.recordStage(stage, performance.now() - startedAt, false)
      return result
    } catch (error) {
      this.recordStage(stage, performance.now() - startedAt, true)
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
    logger.info('quickbooks.migration.page', { correlationId:this.correlationId, module:this.module, records, extracted, heapUsedBytes:process.memoryUsage().heapUsed })
  }

  accumulate(stage: MigrationStage, durationMs: number, failed = false) {
    this.recordStage(stage,durationMs,failed,false)
  }

  request = (event: ExternalRequestEvent) => {
    const key = `${event.kind}:${event.signature}`
    const aggregate = this.requests.get(key) ?? { kind:event.kind, endpoint:event.endpoint, signature:event.signature, calls:0, failedCalls:0, durationMs:0 }
    aggregate.calls += 1
    aggregate.durationMs += event.durationMs
    if (event.status === null || event.status >= 400) aggregate.failedCalls += 1
    this.requests.set(key, aggregate)
    if (event.error) logger.warn('quickbooks.migration.network.failed', { correlationId:this.correlationId, module:this.module, kind:event.kind, endpoint:event.endpoint, attempt:event.attempt, ...event.error })
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
