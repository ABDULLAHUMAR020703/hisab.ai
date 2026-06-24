/** Computes display business status — overdue is derived, not stored. */
export function computeDisplayBusinessStatus(input: {
  status: string
  dueDate: string | Date
  balance: number
}): string {
  const status = input.status.toUpperCase()
  if (status === 'PAID' || status === 'DRAFT' || status === 'VOID' || status === 'CANCELLED') {
    return status
  }
  const due = new Date(input.dueDate)
  const open = Number(input.balance) > 0
  if (open && due < new Date() && (status === 'SENT' || status === 'PARTIAL')) {
    return 'OVERDUE'
  }
  return status
}

export function formatInvoiceTypeLabel(type?: string | null): string {
  if (!type) return 'Standard'
  return type.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatZatcaStatusLabel(status?: string | null): string {
  if (!status || status === 'DRAFT') return 'Not Submitted'
  return status.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
