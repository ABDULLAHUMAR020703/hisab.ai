import 'server-only'
import {
  mapChartOfAccountRow,
  mapCustomerRow,
  mapInvoiceLineRow,
  mapInvoiceRow,
  mapPaymentRow,
} from '../entity-mappers'
import type { InvoiceRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import type { InvoiceListOptions, InvoiceRepository } from './invoice.repository.interface'

export const supabaseInvoiceRepository: InvoiceRepository = {
  async findMany(options: InvoiceListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()
    const status = options.status?.trim()

    let query = db
      .from('invoices')
      .select('*, customers(name, email)')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('date', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    let rows = data ?? []
    if (search) {
      const needle = search.toLowerCase()
      rows = rows.filter((row) => {
        const invNo = String(row.invoice_no).toLowerCase()
        const cust = row.customers as { name?: string } | null
        const custName = cust?.name?.toLowerCase() ?? ''
        return invNo.includes(needle) || custName.includes(needle)
      })
    }

    const invoiceIds = rows.map((r) => String(r.id))
    const linesByInvoice = new Map<string, ReturnType<typeof mapInvoiceLineRow>[]>()

    if (invoiceIds.length > 0) {
      const { data: lines, error: lineError } = await db
        .from('invoice_lines')
        .select('*')
        .eq('company_id', companyId)
        .in('invoice_id', invoiceIds)

      if (lineError) throw lineError
      for (const line of lines ?? []) {
        const invoiceId = String(line.invoice_id)
        const bucket = linesByInvoice.get(invoiceId) ?? []
        bucket.push(mapInvoiceLineRow(line))
        linesByInvoice.set(invoiceId, bucket)
      }
    }

    return rows.map((row) => {
      const invoice = mapInvoiceRow(row)
      const cust = row.customers as { name?: string; email?: string | null } | null
      return {
        ...invoice,
        customer: cust ? { name: cust.name ?? '', email: cust.email ?? null } : undefined,
        lines: linesByInvoice.get(invoice.id) ?? [],
      }
    })
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'invoices', id, companyId)
    if (!row) return null

    const invoice = mapInvoiceRow(row)

    const [customerRes, linesRes, paymentsRes, profileRes] = await Promise.all([
      db.from('customers').select('*').eq('id', invoice.customerId).maybeSingle(),
      db.from('invoice_lines').select('*').eq('invoice_id', invoice.id).eq('company_id', companyId),
      db
        .from('payments')
        .select('*')
        .eq('invoice_id', invoice.id)
        .eq('company_id', companyId)
        .is('deleted_at', null),
      invoice.createdById
        ? db.from('profiles').select('full_name').eq('id', invoice.createdById).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (customerRes.error) throw customerRes.error
    if (linesRes.error) throw linesRes.error
    if (paymentsRes.error) throw paymentsRes.error
    if (profileRes.error) throw profileRes.error

    const accountIds = [...new Set((linesRes.data ?? []).map((l) => l.account_id).filter(Boolean))]
    const accounts = new Map<string, ReturnType<typeof mapChartOfAccountRow>>()

    if (accountIds.length > 0) {
      const { data: acctRows, error: acctError } = await db
        .from('chart_of_accounts')
        .select('*')
        .eq('company_id', companyId)
        .in('id', accountIds as string[])
      if (acctError) throw acctError
      for (const acct of acctRows ?? []) {
        accounts.set(String(acct.id), mapChartOfAccountRow(acct))
      }
    }

    return {
      ...invoice,
      customer: customerRes.data ? mapCustomerRow(customerRes.data) : undefined,
      lines: (linesRes.data ?? []).map((line) => ({
        ...mapInvoiceLineRow(line),
        account: line.account_id ? accounts.get(String(line.account_id)) ?? null : null,
      })),
      payments: (paymentsRes.data ?? []).map(mapPaymentRow),
      createdBy: profileRes.data
        ? { name: (profileRes.data.full_name as string | null) ?? null }
        : undefined,
    } as InvoiceRecord
  },
}
