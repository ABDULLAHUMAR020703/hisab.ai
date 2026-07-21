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

export async function GET() {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const client = createAdminClient()
    const { data, error } = await client
      .from('tax_rates')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name')

    if (error) throw error
    return Response.json((data ?? []).map((row) => toApiTaxConfig(row)))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const body = await request.json()
    const name = String(body.name ?? '').trim()
    const category = String(body.category ?? body.type ?? 'VAT').trim() || 'VAT'
    const zatcaMapping = String(body.zatcaMapping ?? 'STANDARD_RATED').trim()
    const percentage = Number(body.percentage ?? body.rate ?? 0)

    const validationError = validateTaxConfigurationInput({
      name,
      percentage,
      category,
      zatcaMapping,
    })
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 })
    }

    const client = createAdminClient()
    const { data, error } = await client
      .from('tax_rates')
      .insert({
        company_id: companyId,
        name,
        rate: percentage,
        type: category === 'VAT' ? 'VAT' : category,
        category,
        zatca_mapping: zatcaMapping,
        is_default: Boolean(body.isDefault),
        is_active: body.isActive !== false,
      })
      .select('*')
      .single()

    if (error) throw error
    return Response.json(toApiTaxConfig(data), { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
