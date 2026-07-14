import 'server-only'
import type { InvoiceType } from '@/lib/db/prisma-types'
import { getCompanyPrimaryCurrency, resolveTransactionCurrency } from '@/lib/currency/company'
import { classifySalesInvoiceType, isAdjustableTaxInvoice, resolveZatcaInvoiceType } from '@/lib/zatca/classification'
import { randomUUID } from 'crypto'
import {
  mapChartOfAccountRow,
  mapCustomerRow,
  mapInvoiceLineRow,
  mapInvoiceRow,
  mapPaymentRow,
} from '../entity-mappers'
import type { InvoiceRecord } from '../entities'
import { isUuid, queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  InvoiceAdjustmentCreateInput,
  InvoiceCreateInput,
  InvoiceLineInput,
  InvoiceListOptions,
  InvoiceRepository,
  InvoiceUpdateInput,
} from './invoice.repository.interface'
import { mapInvoiceSortColumn, resolveInvoiceDateRange } from './invoice-list-utils'

function formatIssueTime(date: Date): string {
  return date.toTimeString().split(' ')[0]
}

function processLines(lines: InvoiceLineInput[]) {
  let subtotal = 0
  let taxAmount = 0
  const processedLines = lines.map((line) => {
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    const taxRate = Number(line.taxRate)
    const amount = quantity * unitPrice
    subtotal += amount
    taxAmount += amount * (taxRate / 100)
    return {
      description: line.description,
      quantity,
      unitPrice: unitPrice,
      taxRate,
      amount,
      accountId: line.accountId || null,
      costCenterId: line.costCenterId || null,
      inventoryItemId: line.inventoryItemId || null,
    }
  })
  return { processedLines, subtotal, taxAmount, total: subtotal + taxAmount }
}

async function resolveInvoiceTypeForCustomer(
  customerId: string,
  companyId: string,
): Promise<'STANDARD' | 'SIMPLIFIED'> {
  const db = supabaseDb()
  const { data, error } = await db
    .from('customers')
    .select('tax_id')
    .eq('id', customerId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  return classifySalesInvoiceType({ taxId: data?.tax_id as string | null | undefined })
}

async function resolveStoredNoteInvoiceType(
  invoiceId: string,
  companyId: string,
): Promise<InvoiceType | null> {
  const db = supabaseDb()
  const { data, error } = await db
    .from('invoices')
    .select('invoice_type')
    .eq('id', invoiceId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  const type = String(data?.invoice_type ?? '')
  if (type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE') return type
  return null
}

async function resolveScopedUuid(
  table: string,
  id: string | null | undefined,
  companyId: string,
): Promise<string | null> {
  if (!id) return null
  const row = await queryByIdOrLegacy(supabaseDb(), table, id, companyId)
  return row ? String(row.id) : null
}

async function resolveProfileUuid(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const db = supabaseDb()

  if (isUuid(userId)) {
    const { data, error } = await db.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (error) throw error
    if (data) return String(data.id)
  }

  const { data, error } = await db
    .from('profiles')
    .select('id')
    .eq('legacy_user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ? String(data.id) : null
}

async function buildLineRows(
  lines: ReturnType<typeof processLines>['processedLines'],
  invoiceId: string,
  companyId: string,
) {
  return Promise.all(
    lines.map(async (line) => ({
      company_id: companyId,
      invoice_id: invoiceId,
      account_id: await resolveScopedUuid('chart_of_accounts', line.accountId, companyId),
      cost_center_id: await resolveScopedUuid('cost_centers', line.costCenterId, companyId),
      inventory_item_id: await resolveScopedUuid('inventory_items', line.inventoryItemId, companyId),
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      tax_rate: line.taxRate,
      amount: line.amount,
    })),
  )
}

export const supabaseInvoiceRepository: InvoiceRepository = {
  async findMany(options: InvoiceListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim().toLowerCase()
    const status = options.status?.trim()
    const zatcaStatus = options.zatcaStatus?.trim()
    const invoiceType = options.invoiceType?.trim()
    const customerId = options.customerId?.trim()
    const page = Math.max(1, options.page ?? 1)
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const sortColumn = mapInvoiceSortColumn(options.sortBy)
    const ascending = options.sortDir === 'asc'
    const { from: dateFrom, to: dateTo } = resolveInvoiceDateRange(options)

    let query = db
      .from('invoices')
      .select('*, customers(name, email)', { count: 'exact' })
      .eq('company_id', companyId)
      .is('deleted_at', null)

    if (status && status !== 'OVERDUE') query = query.eq('status', status)
    if (status === 'OVERDUE') {
      query = query.in('status', ['SENT', 'PARTIAL']).lt('due_date', new Date().toISOString()).gt('balance', 0)
    }
    if (options.overdue) {
      query = query.in('status', ['SENT', 'PARTIAL']).lt('due_date', new Date().toISOString()).gt('balance', 0)
    }
    if (zatcaStatus) query = query.eq('zatca_status', zatcaStatus)
    if (invoiceType) query = query.eq('invoice_type', invoiceType)
    if (customerId) {
      const scopedCustomerId = await resolveScopedUuid('customers', customerId, companyId)
      if (scopedCustomerId) query = query.eq('customer_id', scopedCustomerId)
    }
    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo) query = query.lte('date', dateTo)
    if (search) query = query.ilike('invoice_no', `%${search}%`)

    query = query.order(sortColumn, { ascending, nullsFirst: false })
    if (sortColumn !== 'created_at') {
      query = query.order('created_at', { ascending: false })
    }

    const offset = (page - 1) * limit
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw error

    let rows = data ?? []
    if (search) {
      rows = rows.filter((row) => {
        const invNo = String(row.invoice_no).toLowerCase()
        const cust = row.customers as { name?: string } | null
        const custName = cust?.name?.toLowerCase() ?? ''
        return invNo.includes(search) || custName.includes(search)
      })
    }

    if (options.sortBy === 'customerName') {
      rows = [...rows].sort((a, b) => {
        const aName = String((a.customers as { name?: string } | null)?.name ?? '')
        const bName = String((b.customers as { name?: string } | null)?.name ?? '')
        const cmp = aName.localeCompare(bName)
        return ascending ? cmp : -cmp
      })
    }

    const items = rows.map((row) => {
      const invoice = mapInvoiceRow(row)
      const cust = row.customers as { name?: string; email?: string | null } | null
      return {
        ...invoice,
        customer: cust ? { name: cust.name ?? '', email: cust.email ?? null } : undefined,
      }
    })

    return {
      items,
      total: count ?? items.length,
      page,
      limit,
    }
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

    let referencedInvoiceNo: string | null = null
    let referencedInvoiceType: string | null = null
    if (invoice.referencedInvoiceId) {
      const refRow = await queryByIdOrLegacy(db, 'invoices', invoice.referencedInvoiceId, companyId)
      referencedInvoiceNo = refRow ? String(refRow.invoice_no) : null
      referencedInvoiceType = refRow ? String(refRow.invoice_type) : null
    }

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
      referencedInvoiceNo,
      referencedInvoiceType,
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

  async create(input: InvoiceCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const customerId = await resolveScopedUuid('customers', input.customerId, companyId)
    if (!customerId) throw new Error('Customer not found')

    const { processedLines, subtotal, taxAmount, total } = processLines(input.lines)
    const invoiceNo = await resolveSequenceRepository().next('INVOICE', 'INV-')
    const issueDate = new Date(input.date)
    const createdById = await resolveProfileUuid(input.createdById)
    const invoiceType = await resolveInvoiceTypeForCustomer(customerId, companyId)
    const currency = await resolveTransactionCurrency(input.currency)

    const { data, error } = await db
      .from('invoices')
      .insert({
        company_id: companyId,
        invoice_no: invoiceNo,
        invoice_uuid: randomUUID(),
        customer_id: customerId,
        invoice_type: invoiceType,
        date: issueDate.toISOString(),
        issue_time: formatIssueTime(issueDate),
        due_date: new Date(input.dueDate).toISOString(),
        currency,
        subtotal,
        tax_amount: taxAmount,
        total,
        balance: total,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        is_recurring: input.isRecurring ?? false,
        recurring_day: input.recurringDay ?? null,
        created_by_id: createdById,
      })
      .select('*')
      .single()

    if (error) throw error

    const invoiceId = String(data.id)
    const lineRows = await buildLineRows(processedLines, invoiceId, companyId)
    if (lineRows.length > 0) {
      const { error: lineError } = await db.from('invoice_lines').insert(lineRows)
      if (lineError) throw lineError
    }

    const created = await this.findById(invoiceId)
    if (!created) throw new Error('Invoice not found')
    return created
  },

  async createAdjustment(input: InvoiceAdjustmentCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const sourceInvoiceId = await resolveScopedUuid('invoices', input.sourceInvoiceId, companyId)
    if (!sourceInvoiceId) throw new Error('Source invoice not found')

    const source = await this.findById(sourceInvoiceId)
    if (!source) throw new Error('Source invoice not found')
    if (!isAdjustableTaxInvoice(source.invoiceType)) {
      throw new Error('Credit/debit notes can only be created from a standard or simplified tax invoice')
    }
    if (!source.customer) throw new Error('Source invoice customer not found')

    const { processedLines, subtotal, taxAmount, total } = processLines(input.lines)
    if (total <= 0) throw new Error('Adjustment total must be greater than zero')

    const invoiceNo = await resolveSequenceRepository().next('INVOICE', 'INV-')
    const issueDate = new Date(input.date)
    const createdById = await resolveProfileUuid(input.createdById)
    const defaultNote = input.adjustmentType === 'CREDIT_NOTE' ? 'Credit note' : 'Debit note'

    const { data, error } = await db
      .from('invoices')
      .insert({
        company_id: companyId,
        invoice_no: invoiceNo,
        invoice_uuid: randomUUID(),
        customer_id: source.customerId,
        invoice_type: input.adjustmentType,
        referenced_invoice_id: sourceInvoiceId,
        date: issueDate.toISOString(),
        issue_time: formatIssueTime(issueDate),
        due_date: new Date(input.dueDate).toISOString(),
        currency: source.currency,
        subtotal,
        tax_amount: taxAmount,
        total,
        balance: total,
        notes: input.notes?.trim() || `${defaultNote} for ${source.invoiceNo}`,
        terms: source.terms ?? null,
        created_by_id: createdById,
      })
      .select('*')
      .single()

    if (error) throw error

    const invoiceId = String(data.id)
    const lineRows = await buildLineRows(processedLines, invoiceId, companyId)
    if (lineRows.length > 0) {
      const { error: lineError } = await db.from('invoice_lines').insert(lineRows)
      if (lineError) throw lineError
    }

    const created = await this.findById(invoiceId)
    if (!created) throw new Error('Invoice not found')
    return created
  },

  async update(id: string, input: InvoiceUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const invoiceId = await resolveScopedUuid('invoices', id, companyId)
    if (!invoiceId) throw new Error('Invoice not found')

    const existingRow = await queryByIdOrLegacy(db, 'invoices', invoiceId, companyId)
    if (!existingRow) throw new Error('Invoice not found')
    const existing = mapInvoiceRow(existingRow)
    if (existing.status === 'PAID') throw new Error('Cannot edit paid invoice')

    const patch: Record<string, unknown> = {}
    if (input.customerId !== undefined) {
      const customerId = await resolveScopedUuid('customers', input.customerId, companyId)
      if (!customerId) throw new Error('Customer not found')
      patch.customer_id = customerId
    }
    if (input.date !== undefined) patch.date = new Date(input.date).toISOString()
    if (input.dueDate !== undefined) patch.due_date = new Date(input.dueDate).toISOString()
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.terms !== undefined) patch.terms = input.terms
    if (input.status !== undefined) patch.status = input.status
    if (input.currency !== undefined) {
      patch.currency = await resolveTransactionCurrency(input.currency)
    }

    const noteType = await resolveStoredNoteInvoiceType(invoiceId, companyId)
    const customerIdForClassification = input.customerId !== undefined
      ? (patch.customer_id as string)
      : String(existingRow.customer_id)
    if (!noteType && customerIdForClassification) {
      patch.invoice_type = await resolveInvoiceTypeForCustomer(customerIdForClassification, companyId)
    }

    if (input.lines !== undefined) {
      const { processedLines, subtotal, taxAmount, total } = processLines(input.lines)
      patch.subtotal = subtotal
      patch.tax_amount = taxAmount
      patch.total = total
      patch.balance = total - existing.amountPaid

      const { error: deleteLineError } = await db
        .from('invoice_lines')
        .delete()
        .eq('company_id', companyId)
        .eq('invoice_id', invoiceId)
      if (deleteLineError) throw deleteLineError

      const lineRows = await buildLineRows(processedLines, invoiceId, companyId)
      if (lineRows.length > 0) {
        const { error: insertLineError } = await db.from('invoice_lines').insert(lineRows)
        if (insertLineError) throw insertLineError
      }
    }

    const { error } = await db
      .from('invoices')
      .update(patch)
      .eq('id', invoiceId)
      .eq('company_id', companyId)
      .is('deleted_at', null)

    if (error) throw error

    const updated = await this.findById(invoiceId)
    if (!updated) throw new Error('Invoice not found')
    return updated
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const invoiceId = await resolveScopedUuid('invoices', id, companyId)
    if (!invoiceId) throw new Error('Invoice not found')

    const existingRow = await queryByIdOrLegacy(db, 'invoices', invoiceId, companyId)
    if (!existingRow) throw new Error('Invoice not found')
    const existing = mapInvoiceRow(existingRow)
    if (existing.status === 'PAID') throw new Error('Cannot delete paid invoice')

    const { error } = await db
      .from('invoices')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
