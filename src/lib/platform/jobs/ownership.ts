import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/ops/logger'
import { OwnershipLostError } from './ownership-error'

export { OwnershipLostError, isOwnershipLostError } from './ownership-error'

export interface JobOwnership {
  readonly platformJobId: string
  readonly attempt: number
  readonly signal: AbortSignal
  isLost(): boolean
  markLost(reason?: string): void
  assertOwned(): Promise<void>
}

/** Verifies the queue row is still RUNNING for this exact attempt (lease). */
export async function verifyJobOwnership(platformJobId: string, attempt: number): Promise<boolean> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('job_queue')
    .select('id,status,attempts')
    .eq('id', platformJobId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data && String(data.status) === 'RUNNING' && Number(data.attempts) === attempt)
}

/**
 * Lease tied to a claimed queue job. Heartbeat failures, attempt changes, and
 * stale recovery all invalidate the lease; callers must stop mutating import state.
 */
export function createJobOwnership(platformJobId: string, attempt: number): JobOwnership {
  let lost = false
  const controller = new AbortController()

  return {
    platformJobId,
    attempt,
    signal: controller.signal,
    isLost: () => lost,
    markLost(reason = 'ownership_changed') {
      if (lost) return
      lost = true
      if (!controller.signal.aborted) controller.abort()
      logger.warn('platform.jobs.ownership_lost_marked', {
        platformJobId,
        attempt,
        reason,
      })
    },
    async assertOwned() {
      if (lost) throw new OwnershipLostError(platformJobId, attempt)
      const owned = await verifyJobOwnership(platformJobId, attempt)
      if (!owned) {
        this.markLost('verify_failed')
        throw new OwnershipLostError(platformJobId, attempt)
      }
    },
  }
}
