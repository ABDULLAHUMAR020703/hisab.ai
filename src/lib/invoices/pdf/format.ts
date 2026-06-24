export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-SA', {
    style: 'currency',
    currency: currency || 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatPdfDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatPdfDateTime(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function buildAddressLines(parts: {
  buildingNumber?: string | null
  streetAddress?: string | null
  address?: string | null
  district?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}): string[] {
  const street = [parts.buildingNumber, parts.streetAddress || parts.address]
    .filter(Boolean)
    .join(' ')
  const locality = [parts.district, parts.city, parts.postalCode, parts.country]
    .filter(Boolean)
    .join(', ')
  return [street, locality].filter((line) => line.trim().length > 0)
}

export function invoicePdfTitle(invoiceType: string): { title: string; accent: string } {
  switch (invoiceType) {
    case 'SIMPLIFIED':
      return { title: 'SIMPLIFIED TAX INVOICE', accent: '#0f766e' }
    case 'CREDIT_NOTE':
      return { title: 'CREDIT NOTE', accent: '#b91c1c' }
    case 'DEBIT_NOTE':
      return { title: 'DEBIT NOTE', accent: '#b45309' }
    default:
      return { title: 'TAX INVOICE', accent: '#1e40af' }
  }
}
