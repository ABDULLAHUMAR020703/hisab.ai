import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { mapTaxRateRow } from '@/lib/db/entity-mappers'
import { validateTaxConfigurationInput } from '@/lib/invoices/validation'

function toApiTaxConfig(row: Record<string, unknown>) {
  const mapped = mapTaxRateRow(row)
  return {
    id: mapped.id,
    name: mapped.name,
    category: mapped.category,
    zatcaMapping: mapped.zatcaMapping,
    percentage: mapped.rate,
    type: mapped.type,
    isDefault: mapped.isDefault,
    isActive: mapped.isActive,
    createdAt: mapped.createdAt,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const client = createAdminClient()
    const { data, error } = await client
      .from('tax_rates')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(toApiTaxConfig(data))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const body = await request.json()

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.category !== undefined) patch.category = String(body.category).trim()
    if (body.zatcaMapping !== undefined) patch.zatca_mapping = String(body.zatcaMapping).trim()
    if (body.percentage !== undefined || body.rate !== undefined) {
      patch.rate = Number(body.percentage ?? body.rate)
    }
    if (body.isDefault !== undefined) patch.is_default = Boolean(body.isDefault)
    if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive)

    const validationError = validateTaxConfigurationInput({
      name: (patch.name as string) ?? 'Tax',
      percentage: (patch.rate as number) ?? 0,
      category: patch.category as string | undefined,
      zatcaMapping: patch.zatca_mapping as string | undefined,
    })
    if (body.name !== undefined || body.percentage !== undefined || body.rate !== undefined) {
      if (validationError && (body.name !== undefined || body.percentage !== undefined || body.rate !== undefined)) {
        // Re-validate only fields being set
        if (body.percentage !== undefined || body.rate !== undefined) {
          const pct = Number(body.percentage ?? body.rate)
          if (pct < 0 || pct > 100) {
            return Response.json({ error: 'Tax percentage must be between 0 and 100' }, { status: 400 })
          }
        }
        if (body.name !== undefined && !String(body.name).trim()) {
          return Response.json({ error: 'name is required' }, { status: 400 })
        }
        if (body.zatcaMapping !== undefined) {
          const valid = ['STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUTSIDE_SCOPE']
          if (!valid.includes(String(body.zatcaMapping))) {
            return Response.json({ error: 'Invalid zatcaMapping' }, { status: 400 })
          }
        }
      }
    }

    const client = createAdminClient()
    const { data, error } = await client
      .from('tax_rates')
      .update(patch)
      .eq('company_id', companyId)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(toApiTaxConfig(data))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { id } = await params
    const client = createAdminClient()
    const { data, error } = await client
      .from('tax_rates')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('company_id', companyId)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
