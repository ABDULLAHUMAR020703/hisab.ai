import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRedirectPath } from '../../src/lib/security/safe-redirect'
import { isSafeWebhookUrl } from '../../src/lib/security/ssrf'
import {
  validateDocumentUpload,
  buildSafeStorageFileName,
  sanitizeDocumentFileName,
} from '../../src/lib/security/document-upload'
import { hasScope, generateApiKey } from '../../src/lib/platform/api-keys/helpers'

describe('production security', () => {
  describe('safe redirect', () => {
    it('allows relative paths', () => {
      assert.equal(sanitizeRedirectPath('/dashboard'), '/dashboard')
      assert.equal(sanitizeRedirectPath('/invoices/123'), '/invoices/123')
    })

    it('blocks open redirects', () => {
      assert.equal(sanitizeRedirectPath('//evil.com'), '/')
      assert.equal(sanitizeRedirectPath('https://evil.com'), '/')
      assert.equal(sanitizeRedirectPath('/login\\@evil.com'), '/')
      assert.equal(sanitizeRedirectPath(null), '/')
    })
  })

  describe('webhook SSRF protection', () => {
    it('blocks localhost and private IPs', () => {
      assert.equal(isSafeWebhookUrl('http://localhost/hook').ok, false)
      assert.equal(isSafeWebhookUrl('http://127.0.0.1/hook').ok, false)
      assert.equal(isSafeWebhookUrl('http://192.168.1.1/hook').ok, false)
      assert.equal(isSafeWebhookUrl('http://10.0.0.1/hook').ok, false)
    })

    it('allows public HTTPS endpoints', () => {
      assert.equal(isSafeWebhookUrl('https://api.example.com/webhooks').ok, true)
    })

    it('rejects non-http schemes', () => {
      assert.equal(isSafeWebhookUrl('file:///etc/passwd').ok, false)
    })
  })

  describe('document upload validation', () => {
    it('sanitizes path traversal in filenames', () => {
      assert.equal(sanitizeDocumentFileName('../../etc/passwd'), 'passwd')
      assert.equal(sanitizeDocumentFileName('..\\..\\evil.pdf'), 'evil.pdf')
    })

    it('blocks dangerous extensions', () => {
      const file = { name: 'payload.html', type: 'text/html', size: 100 } as File
      assert.equal(typeof validateDocumentUpload(file), 'string')
    })

    it('allows PDF uploads', () => {
      const file = { name: 'invoice.pdf', type: 'application/pdf', size: 1024 } as File
      assert.equal(validateDocumentUpload(file), null)
    })

    it('builds safe storage names', () => {
      const name = buildSafeStorageFileName('my invoice.pdf')
      assert.ok(name.endsWith('.pdf') || name.includes('invoice'))
      assert.ok(!name.includes('/'))
    })
  })

  describe('api key scopes', () => {
    it('enforces scope checks', () => {
      assert.equal(hasScope(['invoices:read'], 'invoices:read'), true)
      assert.equal(hasScope(['*'], 'anything'), true)
      assert.equal(hasScope(['invoices:read'], 'bills:write'), false)
    })

    it('generates non-reversible key hashes', () => {
      const key = generateApiKey()
      assert.ok(key.raw.startsWith('hsk_'))
      assert.notEqual(key.raw, key.hash)
    })
  })
})
