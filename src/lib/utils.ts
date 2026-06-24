import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined, currency = 'SAR') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return new Intl.NumberFormat('en-SA', { style: 'currency', currency }).format(0)
  return new Intl.NumberFormat('en-SA', { style: 'currency', currency }).format(value)
}

export function formatOptionalCurrency(amount: number | null | undefined, currency = 'SAR') {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  return formatCurrency(amount, currency)
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString('en-GB')
}
