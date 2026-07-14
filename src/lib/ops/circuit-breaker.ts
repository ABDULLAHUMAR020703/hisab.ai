export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeoutMs?: number
}

export class CircuitBreaker {
  private failures = 0
  private state: CircuitState = 'CLOSED'
  private openedAt = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN'
    }
    return this.state
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState()
    if (state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN')
    }

    try {
      const result = await fn()
      this.failures = 0
      if (this.state === 'HALF_OPEN') this.state = 'CLOSED'
      return result
    } catch (error) {
      this.failures += 1
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN'
        this.openedAt = Date.now()
      }
      throw error
    }
  }
}
