import type { InvoiceListOptions } from './invoice.repository.interface'

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function resolveInvoiceDateRange(options: Pick<InvoiceListOptions, 'datePreset' | 'dateFrom' | 'dateTo'>) {
  const now = new Date()
  if (options.datePreset === 'today') {
    return { from: startOfDay(now).toISOString(), to: now.toISOString() }
  }
  if (options.datePreset === 'week') {
    const from = new Date(now)
    from.setDate(now.getDate() - 7)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  if (options.datePreset === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  if (options.datePreset === 'custom' || options.dateFrom || options.dateTo) {
    return {
      from: options.dateFrom ? new Date(options.dateFrom).toISOString() : undefined,
      to: options.dateTo ? new Date(options.dateTo).toISOString() : undefined,
    }
  }
  return {}
}

export function mapInvoiceSortColumn(sortBy: InvoiceListOptions['sortBy']): string {
  switch (sortBy) {
    case 'date': return 'date'
    case 'dueDate': return 'due_date'
    case 'invoiceNo': return 'invoice_no'
    case 'total': return 'total'
    default: return 'created_at'
  }
}

export function isInvoiceOverdue(row: { status: string; due_date: string; balance: number | string }) {
  const status = String(row.status).toUpperCase()
  const balance = Number(row.balance)
  if (balance <= 0) return false
  if (status !== 'SENT' && status !== 'PARTIAL') return false
  return new Date(String(row.due_date)) < new Date()
}
