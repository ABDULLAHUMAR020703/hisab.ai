import type { PeriodPreset, ReportPeriod } from './types'

export function resolvePeriod(
  preset: PeriodPreset = 'ytd',
  custom?: { from?: string; to?: string; asOf?: string },
): { period: ReportPeriod; asOf?: Date } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  if (preset === 'custom' && custom?.from && custom?.to) {
    return {
      period: { from: custom.from, to: custom.to, preset: 'custom' },
      asOf: custom.asOf ? new Date(custom.asOf) : new Date(custom.to),
    }
  }

  let from: Date
  let to: Date
  let label: string

  switch (preset) {
    case 'monthly': {
      from = new Date(year, month, 1)
      to = new Date(year, month + 1, 0, 23, 59, 59)
      label = from.toLocaleString('en', { month: 'long', year: 'numeric' })
      break
    }
    case 'quarterly': {
      const qStart = Math.floor(month / 3) * 3
      from = new Date(year, qStart, 1)
      to = new Date(year, qStart + 3, 0, 23, 59, 59)
      label = `Q${Math.floor(qStart / 3) + 1} ${year}`
      break
    }
    case 'yearly': {
      from = new Date(year, 0, 1)
      to = new Date(year, 11, 31, 23, 59, 59)
      label = String(year)
      break
    }
    case 'last_month': {
      from = new Date(year, month - 1, 1)
      to = new Date(year, month, 0, 23, 59, 59)
      label = from.toLocaleString('en', { month: 'long', year: 'numeric' })
      break
    }
    case 'last_quarter': {
      const qStart = Math.floor(month / 3) * 3 - 3
      from = new Date(year, qStart, 1)
      to = new Date(year, qStart + 3, 0, 23, 59, 59)
      label = `Q${Math.floor(qStart / 3) + 1} ${from.getFullYear()}`
      break
    }
    case 'last_year': {
      from = new Date(year - 1, 0, 1)
      to = new Date(year - 1, 11, 31, 23, 59, 59)
      label = String(year - 1)
      break
    }
    case 'ytd':
    default: {
      from = new Date(year, 0, 1)
      to = now
      label = `YTD ${year}`
      break
    }
  }

  return {
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      preset,
      label,
    },
    asOf: custom?.asOf ? new Date(custom.asOf) : to,
  }
}

export function priorPeriod(period: ReportPeriod): ReportPeriod {
  const from = new Date(period.from)
  const to = new Date(period.to)
  const durationMs = to.getTime() - from.getTime()
  const priorTo = new Date(from.getTime() - 1)
  const priorFrom = new Date(priorTo.getTime() - durationMs)
  return {
    from: priorFrom.toISOString(),
    to: priorTo.toISOString(),
    preset: 'custom',
    label: 'Prior period',
  }
}

export function monthlyBuckets(from: Date, to: Date): Array<{ key: string; from: Date; to: Date; label: string }> {
  const buckets: Array<{ key: string; from: Date; to: Date; label: string }> = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  while (cursor <= to) {
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
    buckets.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      from: new Date(cursor),
      to: end > to ? to : end,
      label: cursor.toLocaleString('en', { month: 'short', year: 'numeric' }),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return buckets
}
