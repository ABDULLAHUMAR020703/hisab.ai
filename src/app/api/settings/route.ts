import { requireAuth } from '@/lib/auth'
import { stripLogoCacheBuster } from '@/lib/branding/logo-url'
import { getSettingsRepository } from '@/lib/db/provider'
import type { CompanySettingsUpdateInput } from '@/lib/db/types'

export async function GET() {
  try {
    await requireAuth()
    const settingsRepo = getSettingsRepository()

    const settings = await settingsRepo.findFirst()
    if (!settings) {
      return Response.json({ error: 'Company settings not found' }, { status: 404 })
    }
    return Response.json({
      ...settings,
      logoUrl: stripLogoCacheBuster(settings.logoUrl),
      logoUploadedAt: settings.logoUploadedAt?.toISOString() ?? null,
    })
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
    const settingsRepo = getSettingsRepository()

    const data: CompanySettingsUpdateInput = {
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
      website: body.website,
      currency: body.currency,
      fiscalYearStart: body.fiscalYearStart,
      zatcaEnabled: body.zatcaEnabled,
      zatcaConnected: body.zatcaConnected,
      zatcaEnvironment: body.zatcaEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
      zatcaEgsUnitId: body.zatcaEgsUnitId?.trim() || null,
      zatcaBusinessCategory: body.zatcaBusinessCategory?.trim() || null,
    }

    const settings = await settingsRepo.upsert(data)
    return Response.json(settings)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
