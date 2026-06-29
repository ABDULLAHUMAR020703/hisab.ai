import { requireAuth } from '@/lib/auth'
import { isZatcaAdmin, ZatcaForbiddenError } from '@/lib/zatca/authz'
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
    const user = await requireAuth()
    const body = await request.json()
    const settingsRepo = getSettingsRepository()

    const touchesZatcaAdminFields = [
      body.zatcaEnabled,
      body.zatcaConnected,
      body.zatcaEnvironment,
      body.zatcaBusinessCategory,
      body.zatcaEgsUnitId,
    ].some((value) => value !== undefined)

    if (touchesZatcaAdminFields && !isZatcaAdmin(user)) {
      throw new ZatcaForbiddenError('Only company owners and administrators can change ZATCA settings.')
    }

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
      zatcaEgsUnitId: body.zatcaEgsUnitId?.trim() || null,
      zatcaBusinessCategory: body.zatcaBusinessCategory?.trim() || null,
    }

    // Active environment is switched via /api/zatca/connection/environment only.
    if (body.zatcaEnvironment !== undefined && isZatcaAdmin(user)) {
      data.zatcaEnvironment = body.zatcaEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'
    }

    const settings = await settingsRepo.upsert(data)
    return Response.json(settings)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ZatcaForbiddenError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
