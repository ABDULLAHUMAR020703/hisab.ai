import { logger } from '@/lib/ops/logger'

export interface ProgressWriteQueue {
  /** Appends a write that runs after all previously enqueued writes. */
  enqueue(write: () => Promise<void>): void
  /** Resolves once every enqueued write has settled. Never rejects. */
  drain(): Promise<void>
  /** Number of writes that failed and were skipped. */
  readonly failureCount: number
}

/**
 * Serializes import-job progress writes without letting one failed write poison
 * the rest. A rejected link would otherwise stay unhandled until the step ends,
 * which terminates the worker process mid-migration and skips every later write.
 * Progress persistence is observability, so failures are logged and dropped.
 */
export function createProgressWriteQueue(context: {
  importJobId: string
  companyId?: string
  platformJobId?: string
  attempt?: number
}): ProgressWriteQueue {
  let tail: Promise<void> = Promise.resolve()
  let failureCount = 0

  return {
    get failureCount() {
      return failureCount
    },
    enqueue(write) {
      tail = tail.then(async () => {
        try {
          await write()
        } catch (error) {
          failureCount += 1
          logger.error('quickbooks.import_job.progress.write_dropped', {
            importJobId: context.importJobId,
            companyId: context.companyId,
            platformJobId: context.platformJobId,
            attempt: context.attempt,
            failureCount,
            error: error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
          })
        }
      })
    },
    drain() {
      return tail
    },
  }
}
