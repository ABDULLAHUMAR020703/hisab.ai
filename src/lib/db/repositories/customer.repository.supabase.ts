import 'server-only'
import { mapCustomerRow, mapInvoiceRow } from '../entity-mappers'
import type { CustomerRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  CustomerCreateInput,
  CustomerListOptions,
  CustomerRepository,
  CustomerUpdateInput,
} from './customer.repository.interface'

const OPEN_STATUSES = ['SENT', 'PARTIAL', 'OVERDUE']

async function attachOutstanding(
  customers: CustomerRecord[],
  companyId: string,
): Promise<CustomerRecord[]> {
  if (customers.length === 0) return customers
  const db = supabaseDb()
  const ids = customers.map((c) => c.id)
  const { data: invoices, error } = await db
    .from('invoices')
    .select('customer_id, balance, status')
    .eq('company_id', companyId)
    .in('customer_id', ids)
    .is('deleted_at', null)

  if (error) throw error

  return customers.map((c) => {
    const related = (invoices ?? []).filter((i) => i.customer_id === c.id)
    const outstandingBalance = related
      .filter((i) => OPEN_STATUSES.includes(String(i.status)))
      .reduce((s, i) => s + Number(i.balance), 0)
    return { ...c, outstandingBalance }
  })
}

async function resolveCustomerUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'customers', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseCustomerRepository: CustomerRepository = {
  async findMany(options: CustomerListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('customers')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,customer_no.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) throw error

    const customers = (data ?? []).map(mapCustomerRow)
    return attachOutstanding(customers, companyId)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'customers', id, companyId)
    if (!row) return null

    const customer = mapCustomerRow(row)
    const { data: invoices, error } = await db
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .eq('customer_id', customer.id)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .limit(10)

    if (error) throw error
    return {
      ...customer,
      invoices: (invoices ?? []).map(mapInvoiceRow),
    } as CustomerRecord
  },

  async create(input: CustomerCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const customerNo = await resolveSequenceRepository().next('CUSTOMER', 'CUST-')

    const { data, error } = await db
      .from('customers')
      .insert({
        company_id: companyId,
        customer_no: customerNo,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        tax_id: input.taxId ?? null,
        credit_limit: input.creditLimit ?? 0,
        payment_terms: input.paymentTerms ?? 30,
      })
      .select('*')
      .single()

    if (error) throw error
    return mapCustomerRow(data)
  },

  async update(id: string, input: CustomerUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const customerId = await resolveCustomerUuid(id, companyId)
    if (!customerId) throw new Error('Customer not found')

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.email !== undefined) patch.email = input.email
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.address !== undefined) patch.address = input.address
    if (input.city !== undefined) patch.city = input.city
    if (input.country !== undefined) patch.country = input.country
    if (input.taxId !== undefined) patch.tax_id = input.taxId
    if (input.creditLimit !== undefined) patch.credit_limit = input.creditLimit
    if (input.paymentTerms !== undefined) patch.payment_terms = input.paymentTerms
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await db
      .from('customers')
      .update(patch)
      .eq('id', customerId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapCustomerRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const customerId = await resolveCustomerUuid(id, companyId)
    if (!customerId) throw new Error('Customer not found')

    const { error } = await db
      .from('customers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
