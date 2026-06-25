/** Reusable company branding fields for PDFs, quotations, reports, etc. */
export interface CompanyBranding {
  companyId: string
  companyName: string
  legalName: string | null
  logoUrl: string | null
  logoStoragePath: string | null
  logoUploadedAt: Date | null
}

export interface CompanyLogoUploadResult {
  logoUrl: string
  logoStoragePath: string
  logoUploadedAt: string
}
