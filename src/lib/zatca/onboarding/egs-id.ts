import { randomBytes } from 'crypto'

/**
 * Generates a unique EGS unit identifier when the user has not set one explicitly.
 * Format: {COMPANY_SLUG}-{random hex} — must still be saved to CompanySettings before CSR.
 */
export function generateEGSUnitId(companyName?: string | null, vatNumber?: string | null): string {
  const fromName = (companyName ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)
    .toUpperCase()

  const fromVat = (vatNumber ?? '').replace(/\D/g, '').slice(-6)
  const prefix = fromName || (fromVat ? `EGS${fromVat}` : 'EGS')
  const suffix = randomBytes(4).toString('hex')
  return `${prefix}-${suffix}`
}
