import { prisma } from '@/lib/prisma'
import { seedQaData } from '@/lib/qa-seed'

const DEMO_COMPANY = {
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
}

export async function ensureDemoCompanySettings() {
  const existing = await prisma.companySettings.findFirst()
  if (!existing) {
    await prisma.companySettings.create({ data: DEMO_COMPANY })
    return
  }

  await prisma.companySettings.update({
    where: { id: existing.id },
    data: {
      legalName: existing.legalName ?? DEMO_COMPANY.legalName,
      taxId: existing.taxId ?? DEMO_COMPANY.taxId,
      commercialRegistration: existing.commercialRegistration ?? DEMO_COMPANY.commercialRegistration,
      streetAddress: existing.streetAddress ?? DEMO_COMPANY.streetAddress,
      buildingNumber: existing.buildingNumber ?? DEMO_COMPANY.buildingNumber,
      district: existing.district ?? DEMO_COMPANY.district,
      city: existing.city ?? DEMO_COMPANY.city,
      postalCode: existing.postalCode ?? DEMO_COMPANY.postalCode,
      zatcaEnabled: true,
    },
  })
}
