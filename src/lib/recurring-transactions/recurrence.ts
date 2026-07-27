import type { Frequency } from './types'

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** Calendar-safe recurrence calculation; monthly/yearly rules preserve end-of-month intent. */
export function calculateNextExecutionDate(
  currentValue: string | Date,
  frequency: Frequency,
  intervalCount = 1,
  customRule: Record<string, unknown> = {},
): Date {
  const current = new Date(currentValue)
  if (Number.isNaN(current.getTime())) throw new Error('Invalid recurrence date')
  const interval = Math.max(1, Math.trunc(intervalCount))
  const next = new Date(current)

  if (frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + interval)
  else if (frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + interval * 7)
  else if (frequency === 'MONTHLY') {
    const originalDay = current.getUTCDate()
    const targetMonth = current.getUTCMonth() + interval
    next.setUTCDate(1)
    next.setUTCMonth(targetMonth)
    next.setUTCDate(Math.min(originalDay, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())))
  } else if (frequency === 'YEARLY') {
    const month = current.getUTCMonth()
    const day = current.getUTCDate()
    next.setUTCDate(1)
    next.setUTCFullYear(current.getUTCFullYear() + interval)
    next.setUTCMonth(month)
    next.setUTCDate(Math.min(day, daysInMonth(next.getUTCFullYear(), month)))
  } else {
    const unit = String(customRule.unit ?? 'day').toLowerCase()
    const every = Math.max(1, Number(customRule.every ?? interval))
    if (unit === 'week') next.setUTCDate(next.getUTCDate() + every * 7)
    else if (unit === 'month') return calculateNextExecutionDate(current, 'MONTHLY', every)
    else if (unit === 'year') return calculateNextExecutionDate(current, 'YEARLY', every)
    else next.setUTCDate(next.getUTCDate() + every)
  }
  return next
}

export function describeInterval(frequency: Frequency, intervalCount: number) {
  const count = Math.max(1, intervalCount)
  const labels: Record<Exclude<Frequency, 'CUSTOM'>, string> = {
    DAILY: 'Day', WEEKLY: 'Week', MONTHLY: 'Month', YEARLY: 'Year',
  }
  if (frequency === 'CUSTOM') return 'Custom'
  return `Every ${count === 1 ? '' : `${count} `}${labels[frequency]}${count === 1 ? '' : 's'}`
}
