import { getSettingsRepository } from '@/lib/db/provider'

export async function ensureDemoCompanySettings() {
  const repo = getSettingsRepository()
  const existing = await repo.findFirst()
  if (existing) return existing

  return repo.create({
    companyName: 'NETKOM COMPANY FOR COMMUNICATION',
    legalName: 'NETKOM COMPANY FOR COMMUNICATION LLC',
    taxId: '300000000000003',
    commercialRegistration: '1010000000',
    streetAddress: 'King Fahd Road',
    buildingNumber: '4521',
    district: 'Al Olaya',
    city: 'Riyadh',
    postalCode: '12211',
    country: 'Saudi Arabia',
    currency: 'SAR',
    fiscalYearStart: '01-01',
    zatcaEnabled: true,
  })
}
