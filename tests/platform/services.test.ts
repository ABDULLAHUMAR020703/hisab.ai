import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateConditions } from '../../src/lib/platform/automation/conditions'
import { signPayload, hashSecret } from '../../src/lib/platform/webhooks/signing'
import { checkRateLimit, hasScope, generateApiKey } from '../../src/lib/platform/api-keys/helpers'
import { formatNumber, formatDate } from '../../src/lib/platform/localization/format'
import { ageBucket } from '../../src/lib/reporting/aging-utils'

describe('platform services', () => {
  describe('automation conditions', () => {
    it('evaluates AND rules on event payload', () => {
      const result = evaluateConditions(
        { operator: 'AND', rules: [{ field: 'status', op: 'eq', value: 'APPROVED' }, { field: 'amount', op: 'gte', value: 1000 }] },
        { status: 'APPROVED', amount: 5000 },
      )
      assert.equal(result, true)
    })

    it('evaluates OR rules', () => {
      const result = evaluateConditions(
        { operator: 'OR', rules: [{ field: 'type', op: 'eq', value: 'BILL' }, { field: 'type', op: 'eq', value: 'INVOICE' }] },
        { type: 'INVOICE' },
      )
      assert.equal(result, true)
    })
  })

  describe('webhook signing', () => {
    it('produces deterministic HMAC signatures', () => {
      const secret = 'test-secret'
      const body = '{"event":"invoice.approved"}'
      const sig1 = signPayload(body, secret)
      const sig2 = signPayload(body, secret)
      assert.equal(sig1, sig2)
      assert.notEqual(sig1, signPayload(body, 'other'))
    })

    it('hashes secrets for storage', () => {
      const hash = hashSecret('my-secret')
      assert.equal(hash.length, 64)
    })
  })

  describe('api key auth', () => {
    it('generates keys with prefix and hash', () => {
      const key = generateApiKey()
      assert.ok(key.raw.startsWith('hsk_'))
      assert.ok(key.prefix.length > 0)
      assert.equal(key.hash.length, 64)
    })

    it('enforces rate limits per key', () => {
      const id = 'test-key-id'
      assert.equal(checkRateLimit(id, 2), true)
      assert.equal(checkRateLimit(id, 2), true)
      assert.equal(checkRateLimit(id, 2), false)
    })

    it('checks scopes including wildcard', () => {
      assert.equal(hasScope(['*'], 'invoices:read'), true)
      assert.equal(hasScope(['invoices:read'], 'invoices:read'), true)
      assert.equal(hasScope(['invoices:read'], 'bills:write'), false)
    })
  })

  describe('localization', () => {
    it('formats numbers by locale', () => {
      const formatted = formatNumber(1234.5, { locale: 'en-US' })
      assert.ok(formatted.includes('1,234'))
    })

    it('formats dates', () => {
      const formatted = formatDate('2026-01-15', { locale: 'en-US', timezone: 'UTC' })
      assert.ok(formatted.length > 0)
    })
  })

  describe('shared aging buckets', () => {
    it('uses standard AR/AP buckets', () => {
      assert.equal(ageBucket(0), 'current')
      assert.equal(ageBucket(45), '31-60')
    })
  })
})
