import 'server-only'
import { mapCostCenterRow } from '../entity-mappers'
import type { CostCenterRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  CostCenterBatchDuplicateInput,
  CostCenterBatchDuplicateMatch,
  CostCenterCreateInput,
  CostCenterDuplicateCriteria,
  CostCenterListOptions,
  CostCenterRepository,
  CostCenterUpdateInput,
} from './cost-center.repository.interface'

async function resolveCostCenterUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'cost_centers', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseCostCenterRepository: CostCenterRepository = {
  async findMany(options: CostCenterListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('cost_centers')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('code', { ascending: true })

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }
    if (options.type?.trim()) {
      query = query.eq('type', options.type.trim())
    }
    if (options.activeOnly) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapCostCenterRow)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'cost_centers', id, companyId)
    return row ? mapCostCenterRow(row) : null
  },

  async findDuplicate(criteria: CostCenterDuplicateCriteria) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const type = criteria.type?.trim()

    const code = criteria.code?.trim()
    if (code) {
      let query = db
        .from('cost_centers')
        .select('*')
        .eq('company_id', companyId)
        .eq('code', code)
        .is('deleted_at', null)
      if (type) query = query.eq('type', type)
      const { data, error } = await query.limit(1).maybeSingle()
      if (error) throw error
      if (data) return mapCostCenterRow(data)
    }

    const name = criteria.name?.trim()
    if (name) {
      // Exact full-name match only (case-insensitive). Escape ILIKE wildcards so
      // characters like "_" in names never match a different class.
      const exactPattern = name.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
      let query = db
        .from('cost_centers')
        .select('*')
        .eq('company_id', companyId)
        .ilike('name', exactPattern)
        .is('deleted_at', null)
      if (type) query = query.eq('type', type)
      const { data, error } = await query.limit(1).maybeSingle()
      if (error) throw error
      if (data) {
        const mapped = mapCostCenterRow(data)
        // Guard against any residual wildcard matching
        if (mapped.name.trim().toLowerCase() === name.toLowerCase()) {
          return mapped
        }
      }
    }

    return null
  },

  async findDuplicatesBatch(inputs: CostCenterBatchDuplicateInput[]) {
    if (inputs.length === 0) return []

    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const codes = [...new Set(inputs.map((item) => item.code?.trim()).filter(Boolean) as string[])]
    const names = [...new Set(inputs.map((item) => item.name?.trim().toLowerCase()).filter(Boolean) as string[])]

    const byCode = new Map<string, CostCenterRecord>()
    const byName = new Map<string, CostCenterRecord>()

    if (codes.length > 0) {
      const { data, error } = await db
        .from('cost_centers')
        .select('*')
        .eq('company_id', companyId)
        .in('code', codes)
        .is('deleted_at', null)
      if (error) throw error
      for (const row of data ?? []) {
        const center = mapCostCenterRow(row)
        byCode.set(center.code, center)
      }
    }

    if (names.length > 0) {
      const { data, error } = await db
        .from('cost_centers')
        .select('id, code, name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (error) throw error

      const nameSet = new Set(names)
      for (const row of data ?? []) {
        const center = mapCostCenterRow(row)
        if (nameSet.has(center.name.toLowerCase())) {
          byName.set(center.name.toLowerCase(), center)
        }
      }
    }

    const matches: CostCenterBatchDuplicateMatch[] = []
    for (const input of inputs) {
      const code = input.code?.trim()
      const name = input.name?.trim().toLowerCase()

      let existing: CostCenterRecord | undefined
      const matchedOn: string[] = []

      if (code && byCode.has(code)) {
        existing = byCode.get(code)
        matchedOn.push('code')
      } else if (name && byName.has(name)) {
        existing = byName.get(name)
        matchedOn.push('name')
      }

      if (existing) {
        matches.push({
          rowNumber: input.rowNumber,
          existingId: existing.id,
          matchedOn: matchedOn.length ? matchedOn : ['name'],
        })
      }
    }

    return matches
  },

  async create(input: CostCenterCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const code = input.code?.trim()
      || await resolveSequenceRepository().next('CC', 'CC-')

    const { data, error } = await db
      .from('cost_centers')
      .insert({
        company_id: companyId,
        code,
        name: input.name,
        type: input.type ?? 'PROJECT',
        description: input.description ?? null,
        is_active: input.isActive ?? true,
        metadata: input.metadata ?? {},
      })
      .select('*')
      .single()

    if (error) throw error
    return mapCostCenterRow(data)
  },

  async update(id: string, input: CostCenterUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const centerId = await resolveCostCenterUuid(id, companyId)
    if (!centerId) throw new Error('Cost center not found')

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.type !== undefined) patch.type = input.type
    if (input.description !== undefined) patch.description = input.description
    if (input.isActive !== undefined) patch.is_active = input.isActive
    if (input.metadata !== undefined) patch.metadata = input.metadata ?? {}

    const { data, error } = await db
      .from('cost_centers')
      .update(patch)
      .eq('id', centerId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapCostCenterRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const centerId = await resolveCostCenterUuid(id, companyId)
    if (!centerId) throw new Error('Cost center not found')

    const { error } = await db
      .from('cost_centers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', centerId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
