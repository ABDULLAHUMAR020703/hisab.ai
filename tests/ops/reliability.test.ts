import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from '../../src/lib/ops/retry'
import { CircuitBreaker } from '../../src/lib/ops/circuit-breaker'
import { buildIdempotencyKey, claimIdempotencyKey, releaseIdempotencyKey } from '../../src/lib/ops/idempotency'
import { incrementCounter, recordDuration, getMetricsSnapshot, resetMetrics } from '../../src/lib/ops/metrics'

describe('reliability primitives', () => {
  describe('retry policy', () => {
    it('retries transient failures', async () => {
      let attempts = 0
      const result = await withRetry(async () => {
        attempts += 1
        if (attempts < 3) throw new Error('transient')
        return 'ok'
      }, { maxAttempts: 3, baseDelayMs: 1 })
      assert.equal(result, 'ok')
      assert.equal(attempts, 3)
    })

    it('stops after max attempts', async () => {
      await assert.rejects(
        () => withRetry(async () => { throw new Error('fail') }, { maxAttempts: 2, baseDelayMs: 1 }),
        /fail/,
      )
    })
  })

  describe('circuit breaker', () => {
    it('opens after repeated failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 })
      const fail = () => breaker.execute(async () => { throw new Error('down') })
      await assert.rejects(fail)
      await assert.rejects(fail)
      await assert.rejects(fail, /OPEN/)
    })
  })

  describe('idempotency', () => {
    it('claims keys once per scope', () => {
      const key = buildIdempotencyKey('co-1', 'invoice-post', 'inv-99')
      assert.equal(claimIdempotencyKey(key), true)
      assert.equal(claimIdempotencyKey(key), false)
      releaseIdempotencyKey(key)
      assert.equal(claimIdempotencyKey(key), true)
    })
  })

  describe('metrics', () => {
    it('tracks counters and histograms', () => {
      resetMetrics()
      incrementCounter('api.requests', 2)
      recordDuration('api.latency', 120)
      const snap = getMetricsSnapshot()
      assert.equal(snap.counters['api.requests'], 2)
      assert.equal(snap.histograms['api.latency'].count, 1)
    })
  })
})
