import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

/** Mirrors service helper without importing server-only modules. */
function formatExpenseTransactionsError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'error', 'details', 'hint'] as const) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    try {
      return JSON.stringify(error)
    } catch {
      // fall through
    }
  }
  const text = String(error)
  return text === '[object Object]' ? 'Unexpected error while loading expense transactions' : text
}

test('expense transactions page never uses browser alert()', () => {
  const page = read('src/app/(dashboard)/expense-transactions/page.tsx')
  assert.doesNotMatch(page, /\balert\s*\(/)
  assert.match(page, /role="alert"/)
  assert.match(page, /readApiError/)
  assert.match(page, /setError\(/)
})

test('expense transactions list does not select missing bills/expenses currency columns', () => {
  const service = read('src/lib/expense-transactions/service.ts')
  assert.match(service, /from\('bills'\)\.select\('id,date,bill_no/)
  assert.match(service, /from\('expenses'\)\.select\('id,date,expense_no/)
  assert.doesNotMatch(service, /from\('bills'\)\.select\([^)]*currency/)
  assert.doesNotMatch(service, /from\('expenses'\)\.select\([^)]*currency/)
  assert.match(service, /fallbackCurrency/)
  assert.match(service, /formatExpenseTransactionsError/)
})

test('authz serializes PostgREST-style errors without [object Object]', () => {
  const authz = read('src/lib/authz.ts')
  assert.match(authz, /serializeAuthzError/)
  assert.match(authz, /JSON\.stringify\(error\)/)

  const message = formatExpenseTransactionsError({
    message: 'column bills.currency does not exist',
    code: '42703',
  })
  assert.equal(message, 'column bills.currency does not exist')
  assert.notEqual(formatExpenseTransactionsError({ code: 'x', details: 'y' }), '[object Object]')
})
