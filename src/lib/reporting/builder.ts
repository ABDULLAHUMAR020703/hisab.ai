import type {
  CalculatedColumn,
  ReportFilter,
  ReportGrouping,
  ReportPagination,
  ReportSort,
} from './types'

function getFieldValue(row: Record<string, unknown>, field: string): unknown {
  if (field in row) return row[field]
  const parts = field.split('.')
  let current: unknown = row
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function applyFilters(
  rows: Array<Record<string, unknown>>,
  filters: ReportFilter[] = [],
): Array<Record<string, unknown>> {
  if (!filters.length) return rows
  return rows.filter((row) =>
    filters.every((f) => {
      const left = getFieldValue(row, f.field)
      const right = f.value
      switch (f.op) {
        case 'eq': return String(left) === String(right)
        case 'neq': return String(left) !== String(right)
        case 'gt': return Number(left) > Number(right)
        case 'gte': return Number(left) >= Number(right)
        case 'lt': return Number(left) < Number(right)
        case 'lte': return Number(left) <= Number(right)
        case 'in': return Array.isArray(right) && right.map(String).includes(String(left))
        case 'contains': return String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase())
        case 'between': {
          const [min, max] = Array.isArray(right) ? right : [0, 0]
          const n = Number(left)
          return n >= Number(min) && n <= Number(max)
        }
        default: return true
      }
    }),
  )
}

export function applySorting(
  rows: Array<Record<string, unknown>>,
  sorting: ReportSort[] = [],
): Array<Record<string, unknown>> {
  if (!sorting.length) return rows
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const s of sorting) {
      const av = getFieldValue(a, s.field)
      const bv = getFieldValue(b, s.field)
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      if (cmp !== 0) return s.direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
  return sorted
}

export function applyGrouping(
  rows: Array<Record<string, unknown>>,
  grouping: ReportGrouping[] = [],
): Array<Record<string, unknown>> {
  if (!grouping.length) return rows
  const field = grouping[0].field
  const groups = new Map<string, { key: string; count: number; total: number; rows: Array<Record<string, unknown>> }>()

  for (const row of rows) {
    const key = String(getFieldValue(row, field) ?? '(blank)')
    const bucket = groups.get(key) ?? { key, count: 0, total: 0, rows: [] }
    bucket.count += 1
    bucket.total += Number(getFieldValue(row, 'amount') ?? getFieldValue(row, 'balance') ?? getFieldValue(row, 'total') ?? 0)
    bucket.rows.push(row)
    groups.set(key, bucket)
  }

  return [...groups.values()].map((g) => ({
    group: g.key,
    groupLabel: grouping[0].label ?? field,
    count: g.count,
    total: g.total,
    rows: g.rows,
  }))
}

export function selectColumns(
  rows: Array<Record<string, unknown>>,
  columns?: string[],
): Array<Record<string, unknown>> {
  if (!columns?.length) return rows
  return rows.map((row) => {
    const picked: Record<string, unknown> = {}
    for (const col of columns) picked[col] = getFieldValue(row, col)
    return picked
  })
}

export function applyCalculatedColumns(
  rows: Array<Record<string, unknown>>,
  calculated: CalculatedColumn[] = [],
): Array<Record<string, unknown>> {
  if (!calculated.length) return rows
  return rows.map((row) => {
    const next = { ...row }
    for (const col of calculated) {
      next[col.key] = evaluateFormula(col.formula, row)
    }
    return next
  })
}

export function evaluateFormula(formula: string, row: Record<string, unknown>): number {
  const expr = formula.replace(/\{(\w+)\}/g, (_, key) => String(Number(row[key] ?? 0)))
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0
  try {
    // eslint-disable-next-line no-new-func
    return Number(new Function(`return (${expr})`)())
  } catch {
    return 0
  }
}

export function paginateRows(
  rows: Array<Record<string, unknown>>,
  page = 1,
  pageSize = 50,
): { rows: Array<Record<string, unknown>>; pagination: ReportPagination } {
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: { page: safePage, pageSize, total, totalPages },
  }
}

export function flattenToRows(data: unknown, path = 'rows'): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj[path])) return obj[path] as Array<Record<string, unknown>>
    if (Array.isArray(obj.details)) return obj.details as Array<Record<string, unknown>>
    if (Array.isArray(obj.entries)) return obj.entries as Array<Record<string, unknown>>
  }
  return []
}

export function buildTabularResult(options: {
  rows: Array<Record<string, unknown>>
  filters?: ReportFilter[]
  columns?: string[]
  grouping?: ReportGrouping[]
  sorting?: ReportSort[]
  calculated?: CalculatedColumn[]
  page?: number
  pageSize?: number
}) {
  let rows = applyFilters(options.rows, options.filters)
  rows = applyCalculatedColumns(rows, options.calculated)
  if (options.grouping?.length) {
    const grouped = applyGrouping(rows, options.grouping)
    return { rows: grouped, pagination: undefined }
  }
  rows = applySorting(rows, options.sorting)
  rows = selectColumns(rows, options.columns)
  const { rows: paged, pagination } = paginateRows(rows, options.page, options.pageSize)
  return { rows: paged, pagination }
}
