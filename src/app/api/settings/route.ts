import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    await requireAuth()
    let settings = await prisma.companySettings.findFirst()
    if (!settings) {
      settings = await prisma.companySettings.create({
        data: {
          companyName: 'NETKOM COMPANY FOR COMMUNICATION',
          country: 'Saudi Arabia',
          currency: 'SAR',
        },
      })
    }
    return Response.json(settings)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    const data = {
      companyName: body.companyName,
      legalName: body.legalName,
      taxId: body.taxId,
      commercialRegistration: body.commercialRegistration,
      address: body.address,
      streetAddress: body.streetAddress,
      buildingNumber: body.buildingNumber,
      district: body.district,
      city: body.city,
      postalCode: body.postalCode,
      country: body.country,
      phone: body.phone,
      email: body.email,
      currency: body.currency,
      fiscalYearStart: body.fiscalYearStart,
      zatcaEnabled: body.zatcaEnabled,
      zatcaConnected: body.zatcaConnected,
      zatcaEnvironment: body.zatcaEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
      zatcaEgsUnitId: body.zatcaEgsUnitId?.trim() || null,
      zatcaBusinessCategory: body.zatcaBusinessCategory?.trim() || null,
    } as const

    let settings = await prisma.companySettings.findFirst()
    if (!settings) {
      settings = await prisma.companySettings.create({ data })
    } else {
      settings = await prisma.companySettings.update({
        where: { id: settings.id },
        data,
      })
    }

    return Response.json(settings)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
