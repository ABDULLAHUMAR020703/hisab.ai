import 'server-only'
import { mapTaxRateRow } from '../entity-mappers'
import type { TaxRateRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import type {
  TaxRateBatchDuplicateInput,
  TaxRateBatchDuplicateMatch,
  TaxRateCreateInput,
  TaxRateDuplicateCriteria,
  TaxRateListOptions,
  TaxRateRepository,
  TaxRateUpdateInput,
} from './tax-rate.repository.interface'

async function resolveTaxRateUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'tax_rates', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseTaxRateRepository: TaxRateRepository = {
  async findMany(options: TaxRateListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('tax_rates')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('rate', { ascending: false })

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapTaxRateRow)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'tax_rates', id, companyId)
    return row ? mapTaxRateRow(row) : null
  },

  async findDuplicate(criteria: TaxRateDuplicateCriteria) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const name = criteria.name?.trim()
    if (!name) return null

    const { data, error } = await db
      .from('tax_rates')
      .select('*')
      .eq('company_id', companyId)
      .ilike('name', name)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return data ? mapTaxRateRow(data) : null
  },

  async findDuplicatesBatch(inputs: TaxRateBatchDuplicateInput[]) {
    if (inputs.length === 0) return []

    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const names = [...new Set(inputs.map((item) => item.name?.trim().toLowerCase()).filter(Boolean) as string[])]

    const byName = new Map<string, TaxRateRecord>()
    if (names.length > 0) {
      const { data, error } = await db
        .from('tax_rates')
        .select('id, name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (error) throw error

      const nameSet = new Set(names)
      for (const row of data ?? []) {
        const taxRate = mapTaxRateRow(row)
        if (nameSet.has(taxRate.name.toLowerCase())) {
          byName.set(taxRate.name.toLowerCase(), taxRate)
        }
      }
    }

    const matches: TaxRateBatchDuplicateMatch[] = []
    for (const input of inputs) {
      const name = input.name?.trim().toLowerCase()
      if (name && byName.has(name)) {
        matches.push({
          rowNumber: input.rowNumber,
          existingId: byName.get(name)!.id,
          matchedOn: ['name'],
        })
      }
    }

    return matches
  },

  async create(input: TaxRateCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    if (input.isDefault) {
      await db
        .from('tax_rates')
        .update({ is_default: false })
        .eq('company_id', companyId)
        .is('deleted_at', null)
    }

    const { data, error } = await db
      .from('tax_rates')
      .insert({
        company_id: companyId,
        name: input.name,
        rate: input.rate,
        type: input.type ?? 'VAT',
        is_default: input.isDefault ?? false,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single()

    if (error) throw error
    return mapTaxRateRow(data)
  },

  async update(id: string, input: TaxRateUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const taxRateId = await resolveTaxRateUuid(id, companyId)
    if (!taxRateId) throw new Error('Tax rate not found')

    if (input.isDefault) {
      await db
        .from('tax_rates')
        .update({ is_default: false })
        .eq('company_id', companyId)
        .is('deleted_at', null)
    }

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.rate !== undefined) patch.rate = input.rate
    if (input.type !== undefined) patch.type = input.type
    if (input.isDefault !== undefined) patch.is_default = input.isDefault
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await db
      .from('tax_rates')
      .update(patch)
      .eq('id', taxRateId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapTaxRateRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const taxRateId = await resolveTaxRateUuid(id, companyId)
    if (!taxRateId) throw new Error('Tax rate not found')

    const { error } = await db
      .from('tax_rates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', taxRateId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
