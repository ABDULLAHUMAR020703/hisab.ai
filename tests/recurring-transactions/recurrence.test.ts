import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateNextExecutionDate, describeInterval } from '../../src/lib/recurring-transactions/recurrence'

test('daily and weekly intervals advance in UTC', () => {
  assert.equal(calculateNextExecutionDate('2026-07-27T09:30:00Z', 'DAILY', 2).toISOString(), '2026-07-29T09:30:00.000Z')
  assert.equal(calculateNextExecutionDate('2026-07-27T09:30:00Z', 'WEEKLY', 3).toISOString(), '2026-08-17T09:30:00.000Z')
})

test('monthly recurrence clamps to the target month end', () => {
  assert.equal(calculateNextExecutionDate('2026-01-31T12:00:00Z', 'MONTHLY').toISOString(), '2026-02-28T12:00:00.000Z')
  assert.equal(calculateNextExecutionDate('2024-01-31T12:00:00Z', 'MONTHLY').toISOString(), '2024-02-29T12:00:00.000Z')
})

test('yearly recurrence handles leap day safely', () => {
  assert.equal(calculateNextExecutionDate('2024-02-29T00:00:00Z', 'YEARLY').toISOString(), '2025-02-28T00:00:00.000Z')
})

test('custom rules support day, week, month, and year units', () => {
  const start = '2026-01-15T00:00:00Z'
  assert.equal(calculateNextExecutionDate(start, 'CUSTOM', 1, { unit: 'day', every: 10 }).toISOString(), '2026-01-25T00:00:00.000Z')
  assert.equal(calculateNextExecutionDate(start, 'CUSTOM', 1, { unit: 'week', every: 2 }).toISOString(), '2026-01-29T00:00:00.000Z')
  assert.equal(calculateNextExecutionDate(start, 'CUSTOM', 1, { unit: 'month', every: 2 }).toISOString(), '2026-03-15T00:00:00.000Z')
  assert.equal(calculateNextExecutionDate(start, 'CUSTOM', 1, { unit: 'year', every: 2 }).toISOString(), '2028-01-15T00:00:00.000Z')
})

test('interval descriptions remain human-readable', () => {
  assert.equal(describeInterval('MONTHLY', 1), 'Every Month')
  assert.equal(describeInterval('MONTHLY', 3), 'Every 3 Months')
  assert.equal(describeInterval('CUSTOM', 4), 'Custom')
})
