import 'server-only'
import { mapVendorRow } from '../entity-mappers'
import type { VendorRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  VendorBatchDuplicateInput,
  VendorBatchDuplicateMatch,
  VendorCreateInput,
  VendorDuplicateCriteria,
  VendorListOptions,
  VendorRepository,
  VendorUpdateInput,
} from './vendor.repository.interface'

const OPEN_STATUSES = ['RECEIVED', 'PARTIAL', 'OVERDUE']

function mapBillSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    billNo: String(row.bill_no),
    vendorId: String(row.vendor_id),
    date: new Date(String(row.date)),
    dueDate: new Date(String(row.due_date)),
    status: String(row.status),
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    balance: Number(row.balance),
    notes: (row.notes as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    createdById: String(row.created_by_id ?? ''),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  }
}

async function resolveVendorUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'vendors', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseVendorRepository: VendorRepository = {
  async findMany(options: VendorListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('vendors')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,vendor_no.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) throw error

    const vendors = (data ?? []).map(mapVendorRow)
    if (vendors.length === 0 || options.includeOutstanding === false) return vendors

    const ids = vendors.map((v) => v.id)
    const { data: bills, error: billError } = await db
      .from('bills')
      .select('vendor_id, balance, status')
      .eq('company_id', companyId)
      .in('vendor_id', ids)
      .is('deleted_at', null)

    if (billError) throw billError

    return vendors.map((v) => {
      const related = (bills ?? []).filter((b) => b.vendor_id === v.id)
      const outstandingBalance = related
        .filter((b) => OPEN_STATUSES.includes(String(b.status)))
        .reduce((s, b) => s + Number(b.balance), 0)
      return { ...v, outstandingBalance }
    })
  },

  async findDuplicate(criteria: VendorDuplicateCriteria) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const email = criteria.email?.trim()
    if (email) {
      const { data, error } = await db
        .from('vendors')
        .select('*')
        .eq('company_id', companyId)
        .ilike('email', email)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapVendorRow(data)
    }

    const taxId = criteria.taxId?.trim()
    if (taxId) {
      const { data, error } = await db
        .from('vendors')
        .select('*')
        .eq('company_id', companyId)
        .eq('tax_id', taxId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapVendorRow(data)
    }

    const name = criteria.name?.trim()
    if (name) {
      const { data, error } = await db
        .from('vendors')
        .select('*')
        .eq('company_id', companyId)
        .ilike('name', name)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapVendorRow(data)
    }

    return null
  },

  async findDuplicatesBatch(inputs: VendorBatchDuplicateInput[]) {
    if (inputs.length === 0) return []

    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const taxIds = [...new Set(inputs.map((item) => item.taxId?.trim()).filter(Boolean) as string[])]
    const emails = [...new Set(inputs.map((item) => item.email?.trim().toLowerCase()).filter(Boolean) as string[])]
    const names = [...new Set(inputs.map((item) => item.name?.trim().toLowerCase()).filter(Boolean) as string[])]

    const byTaxId = new Map<string, VendorRecord>()
    const byEmail = new Map<string, VendorRecord>()
    const byName = new Map<string, VendorRecord>()

    if (taxIds.length > 0) {
      const { data, error } = await db
        .from('vendors')
        .select('*')
        .eq('company_id', companyId)
        .in('tax_id', taxIds)
        .is('deleted_at', null)
      if (error) throw error
      for (const row of data ?? []) {
        const vendor = mapVendorRow(row)
        if (vendor.taxId) byTaxId.set(vendor.taxId, vendor)
      }
    }

    if (emails.length > 0 || names.length > 0) {
      const { data, error } = await db
        .from('vendors')
        .select('id, email, tax_id, name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (error) throw error

      const emailSet = new Set(emails)
      const nameSet = new Set(names)

      for (const row of data ?? []) {
        const vendor = mapVendorRow(row)
        if (vendor.email && emailSet.has(vendor.email.toLowerCase())) {
          byEmail.set(vendor.email.toLowerCase(), vendor)
        }
        if (nameSet.has(vendor.name.toLowerCase())) {
          byName.set(vendor.name.toLowerCase(), vendor)
        }
      }
    }

    const matches: VendorBatchDuplicateMatch[] = []
    for (const input of inputs) {
      const email = input.email?.trim().toLowerCase()
      const taxId = input.taxId?.trim()
      const name = input.name?.trim().toLowerCase()

      let existing: VendorRecord | undefined
      const matchedOn: string[] = []

      if (email && byEmail.has(email)) {
        existing = byEmail.get(email)
        matchedOn.push('email')
      } else if (taxId && byTaxId.has(taxId)) {
        existing = byTaxId.get(taxId)
        matchedOn.push('taxId')
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

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'vendors', id, companyId)
    if (!row) return null

    const vendor = mapVendorRow(row)
    const { data: bills, error } = await db
      .from('bills')
      .select('*')
      .eq('company_id', companyId)
      .eq('vendor_id', vendor.id)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .limit(10)

    if (error) throw error
    return {
      ...vendor,
      bills: (bills ?? []).map(mapBillSummary),
    } as VendorRecord
  },

  async create(input: VendorCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const vendorNo = await resolveSequenceRepository().next('VENDOR', 'VEND-')

    const { data, error } = await db
      .from('vendors')
      .insert({
        company_id: companyId,
        vendor_no: vendorNo,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        tax_id: input.taxId ?? null,
        payment_terms: input.paymentTerms ?? 30,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single()

    if (error) throw error
    return mapVendorRow(data)
  },

  async update(id: string, input: VendorUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const vendorId = await resolveVendorUuid(id, companyId)
    if (!vendorId) throw new Error('Vendor not found')

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.email !== undefined) patch.email = input.email
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.address !== undefined) patch.address = input.address
    if (input.city !== undefined) patch.city = input.city
    if (input.country !== undefined) patch.country = input.country
    if (input.taxId !== undefined) patch.tax_id = input.taxId
    if (input.paymentTerms !== undefined) patch.payment_terms = input.paymentTerms
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await db
      .from('vendors')
      .update(patch)
      .eq('id', vendorId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapVendorRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const vendorId = await resolveVendorUuid(id, companyId)
    if (!vendorId) throw new Error('Vendor not found')

    const { error } = await db
      .from('vendors')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', vendorId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
