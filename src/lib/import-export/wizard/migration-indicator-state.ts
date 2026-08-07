/**
 * Presentation state for the floating migration indicator.
 * Timers are owned by one controller so expand always cancels the previous
 * auto-collapse arm and polling cannot spawn parallel collapse timers.
 */

export type IndicatorPresentation = 'expanded' | 'collapsed' | 'dismissed' | 'exiting'

export type IndicatorMigrationState = 'running' | 'completed' | 'failed' | 'cancelled'

export const COMPLETED_COLLAPSE_MS = 8_000
export const FAILED_COLLAPSE_MS = 10_000
export const PANEL_EXIT_MS = 220

/** Auto-collapse only applies to terminal success/failure panels. */
export function resolveIndicatorCollapseDelayMs(
  state: IndicatorMigrationState,
): number | null {
  if (state === 'completed') return COMPLETED_COLLAPSE_MS
  if (state === 'failed') return FAILED_COLLAPSE_MS
  return null
}

export function initialIndicatorPresentation(input: {
  sessionId: string
  state: IndicatorMigrationState
  dismissedIds: ReadonlySet<string>
  expandedIds: ReadonlySet<string>
}): IndicatorPresentation {
  if (input.dismissedIds.has(input.sessionId)) return 'dismissed'
  if (input.state === 'completed' || input.state === 'failed') {
    return input.expandedIds.has(input.sessionId) ? 'expanded' : 'collapsed'
  }
  if (input.state === 'cancelled') return 'dismissed'
  return 'expanded'
}

/**
 * Session / migration-state transitions that may change presentation.
 * Progress polls that keep the same session id + state must return null so the
 * open/collapsed choice is never overwritten by hydration churn.
 */
export function presentationForSessionTransition(input: {
  previousSessionId: string
  nextSessionId: string
  previousState: IndicatorMigrationState
  nextState: IndicatorMigrationState
  dismissedIds: ReadonlySet<string>
  expandedIds: ReadonlySet<string>
}): IndicatorPresentation | null {
  if (input.dismissedIds.has(input.nextSessionId)) return 'dismissed'

  if (input.previousSessionId !== input.nextSessionId) {
    return initialIndicatorPresentation({
      sessionId: input.nextSessionId,
      state: input.nextState,
      dismissedIds: input.dismissedIds,
      expandedIds: input.expandedIds,
    })
  }

  if (input.previousState === input.nextState) return null

  if (input.nextState === 'completed' || input.nextState === 'failed') {
    return 'expanded'
  }
  if (input.nextState === 'running') return 'expanded'
  if (input.nextState === 'cancelled') return 'dismissed'
  return null
}

export function presentationAfterExpand(dismissed: boolean): IndicatorPresentation | null {
  if (dismissed) return null
  return 'expanded'
}

export function presentationAfterCollapseRequest(
  current: IndicatorPresentation,
): IndicatorPresentation {
  if (current === 'dismissed' || current === 'collapsed') return current
  return 'exiting'
}

export function presentationAfterExitAnimation(dismissed: boolean): IndicatorPresentation {
  return dismissed ? 'dismissed' : 'collapsed'
}

type TimerHandle = ReturnType<typeof setTimeout>

/**
 * Exactly one auto-collapse timer may be armed. `arm` clears any prior handle
 * before scheduling; `clear` is idempotent.
 */
export class IndicatorAutoCollapseController {
  private handle: TimerHandle | null = null
  private armCount = 0
  private fireCount = 0

  get isArmed(): boolean {
    return this.handle != null
  }

  get timesArmed(): number {
    return this.armCount
  }

  get timesFired(): number {
    return this.fireCount
  }

  arm(delayMs: number, onFire: () => void): void {
    this.clear()
    this.armCount += 1
    this.handle = setTimeout(() => {
      this.handle = null
      this.fireCount += 1
      onFire()
    }, delayMs)
  }

  clear(): void {
    if (this.handle == null) return
    clearTimeout(this.handle)
    this.handle = null
  }
}
