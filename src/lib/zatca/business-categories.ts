/** ZATCA CSR business category (OID 2.5.4.15) options for company settings. */
export const ZATCA_BUSINESS_CATEGORIES = [
  'Telecommunications',
  'Information Technology',
  'Retail Trade',
  'Wholesale Trade',
  'Construction',
  'Real Estate',
  'Healthcare',
  'Education',
  'Transportation',
  'Hospitality',
  'Manufacturing',
  'Professional Services',
  'Financial Services',
  'Energy',
  'Agriculture',
  'Other',
] as const

export type ZatcaBusinessCategory = (typeof ZATCA_BUSINESS_CATEGORIES)[number]

export function resolveBusinessCategory(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  return 'Telecommunications'
}
