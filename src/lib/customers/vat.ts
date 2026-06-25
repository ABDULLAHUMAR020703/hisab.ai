import { SAUDI_VAT_TRN_LENGTH } from '@/lib/zatca/constants'

/** Saudi VAT TRN: 15 digits. */
export function isSaudiVatTrn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === SAUDI_VAT_TRN_LENGTH && /^\d{15}$/.test(digits)
}
