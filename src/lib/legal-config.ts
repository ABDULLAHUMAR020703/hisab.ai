/**
 * Legal and business details used by the public legal documents.
 *
 * Keep these values in deployment configuration. The defaults below are the
 * business details confirmed for production; deployment environment variables
 * may override them without deriving them from customer or tenant records.
 */
export const legalConfig = {
  productName: 'Hisab AI',
  legalEntityName: process.env.LEGAL_ENTITY_NAME ?? 'TechDotGlobal',
  companyName: process.env.COMPANY_NAME ?? 'Hisab AI',
  contactEmail: process.env.LEGAL_CONTACT_EMAIL ?? 'info@techdotglobal.com',
  supportEmail: process.env.SUPPORT_EMAIL ?? 'info@techdotglobal.com',
  privacyEmail: process.env.PRIVACY_EMAIL ?? 'info@techdotglobal.com',
  businessAddress: process.env.BUSINESS_ADDRESS ?? 'Street 63, I-14/3, Islamabad, Pakistan',
  governingLaw: process.env.GOVERNING_LAW ?? 'Pakistan',
  jurisdiction: process.env.JURISDICTION ?? 'Pakistan',
  effectiveDate: process.env.LEGAL_EFFECTIVE_DATE ?? '[TO BE SET ON APPROVAL]',
  primaryDataRegion: process.env.PRIMARY_DATA_REGION ?? 'Sydney, Australia',
  siteUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_PUBLIC_URL ?? '',
} as const

export function getLegalMetadataBase(): URL | undefined {
  try {
    return legalConfig.siteUrl ? new URL(legalConfig.siteUrl) : undefined
  } catch {
    return undefined
  }
}
