import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractErrorReason,
  humanizeImportFailure,
} from '../../src/lib/cost-centers/import/error-reason'

describe('cost center import error reason extraction', () => {
  it('never returns [object Object] for plain objects', () => {
    assert.equal(
      extractErrorReason({ message: 'duplicate key value violates unique constraint' }),
      'duplicate key value violates unique constraint',
    )
    assert.equal(
      extractErrorReason({
        code: '23505',
        details: null,
        hint: null,
        message: 'duplicate key value violates unique constraint "cost_centers_company_id_code_key"',
      }),
      'duplicate key value violates unique constraint "cost_centers_company_id_code_key"',
    )
    assert.notEqual(extractErrorReason({ foo: 'bar' }), '[object Object]')
  })

  it('reads Error.message and nested supabase shapes', () => {
    assert.equal(extractErrorReason(new Error('Name exceeds 255 characters')), 'Name exceeds 255 characters')
    assert.equal(
      extractErrorReason({ error: { message: 'relation does not exist' } }),
      'relation does not exist',
    )
  })

  it('humanizes duplicate database failures by kind', () => {
    assert.equal(
      humanizeImportFailure('class', 'duplicate key value violates unique constraint'),
      'Duplicate class name',
    )
    assert.equal(
      humanizeImportFailure('location', 'unique violation 23505'),
      'Duplicate location name',
    )
    assert.equal(
      humanizeImportFailure(
        'class',
        'duplicate key value violates unique constraint "cost_centers_company_id_code_key"',
      ),
      'Duplicate cost center code — retry import or rename slightly',
    )
  })
})
