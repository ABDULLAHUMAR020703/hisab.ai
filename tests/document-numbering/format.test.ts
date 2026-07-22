import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractTrailingSequenceNumber,
  formatDocumentNumber,
  previewDocumentNumber,
} from '../../src/lib/document-numbering/format'
import { validateDocumentSequenceUpdate } from '../../src/lib/document-numbering/validation'

describe('document number formatting', () => {
  it('pads invoice numbers to the configured width', () => {
    assert.equal(
      formatDocumentNumber({ prefix: 'INV-', number: 91, padding: 6 }),
      'INV-000091',
    )
    assert.equal(
      formatDocumentNumber({ prefix: 'INV-', number: 171, padding: 6 }),
      'INV-000171',
    )
  })

  it('omits padding when padding is 0', () => {
    assert.equal(
      formatDocumentNumber({ prefix: 'INV-', number: 91, padding: 0 }),
      'INV-91',
    )
  })

  it('supports optional suffix', () => {
    assert.equal(
      formatDocumentNumber({ prefix: 'INV-', number: 1, padding: 4, suffix: '-A' }),
      'INV-0001-A',
    )
  })

  it('extracts trailing sequence numbers from issued invoices', () => {
    assert.equal(extractTrailingSequenceNumber('INV-000170'), 170)
    assert.equal(extractTrailingSequenceNumber('INV-91'), 91)
    assert.equal(extractTrailingSequenceNumber('CN-000012'), 12)
    assert.equal(extractTrailingSequenceNumber('INV-000170', 'INV-'), 170)
    assert.equal(extractTrailingSequenceNumber('ZAT-000042', 'INV-'), null)
    assert.equal(extractTrailingSequenceNumber('ZAT-1782231557879', 'INV-'), null)
    assert.equal(extractTrailingSequenceNumber('ZAT-1782231557879'), null)
  })

  it('rejects timestamp-sized sequence numbers', () => {
    assert.throws(() =>
      formatDocumentNumber({ prefix: 'ZAT-', number: 1782231557879, padding: 0 }),
    )
  })
})

describe('document sequence validation', () => {
  it('rejects empty prefix and invalid padding', () => {
    const result = validateDocumentSequenceUpdate({
      prefix: '  ',
      nextNumber: 1,
      padding: 20,
      startingNumber: 1,
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /prefix/i.test(e)))
    assert.ok(result.errors.some((e) => /padding/i.test(e)))
  })

  it('rejects next number below already-issued floor', () => {
    const result = validateDocumentSequenceUpdate(
      { prefix: 'INV-', nextNumber: 50, padding: 6, startingNumber: 1 },
      { minNextNumber: 171 },
    )
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /171/i.test(e)))
  })

  it('rejects timestamp-like next numbers', () => {
    const result = validateDocumentSequenceUpdate({
      prefix: 'ZAT-',
      nextNumber: 1782231557879,
      padding: 6,
      startingNumber: 1,
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /too large|timestamp/i.test(e)))
  })

  it('accepts a valid jump forward', () => {
    const result = validateDocumentSequenceUpdate(
      { prefix: 'INV-', nextNumber: 500, padding: 6, startingNumber: 1 },
      { minNextNumber: 171 },
    )
    assert.equal(result.ok, true)
    assert.equal(result.normalized?.nextNumber, 500)
  })
})
