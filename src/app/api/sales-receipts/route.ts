import { requireAuth } from '@/lib/auth'
import { resolveTransactionCurrency } from '@/lib/currency/company'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { processSalesLines } from '@/lib/sales/line-utils'
import { getNextSequence } from '@/lib/sequences'

function mapSalesReceipt(row: Record<string, unknown>, customer?: { name?: string } | null) {
  return {
    id: String(row.id),
    receiptNo: String(row.receipt_no),
    customerId: row.customer_id ? String(row.customer_id) : null,
    customer: customer ? { name: customer.name ?? '' } : undefined,
    date: row.date,
    currency: String(row.currency ?? 'SAR'),
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    paymentMethod: String(row.payment_method ?? 'CASH'),
    notes: row.notes,
    createdAt: row.created_at,
  }
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim()

    const client = createAdminClient()
    let query = client
      .from('sales_receipts')
      .select('*, customers(name)')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('date', { ascending: false })

    if (search) query = query.ilike('receipt_no', `%${search}%`)

    const { data, error } = await query
    if (error) throw error

    return Response.json((data ?? []).map((row) => {
      const customer = row.customers as { name?: string } | null
      return mapSalesReceipt(row, customer)
    }))
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
    const { customerId, date, currency, lines, notes, paymentMethod, subtotal, taxAmount, total } = body

    if (!date) {
      return Response.json({ error: 'date is required' }, { status: 400 })
    }

    const client = createAdminClient()
    if (customerId) {
      const { data: customer, error: customerError } = await client
        .from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('id', customerId)
        .maybeSingle()
      if (customerError) throw customerError
      if (!customer) return Response.json({ error: 'Customer not found' }, { status: 400 })
    }

    let computedSubtotal = Number(subtotal ?? 0)
    let computedTax = Number(taxAmount ?? 0)
    let computedTotal = Number(total ?? 0)

    if (lines?.length) {
      const processed = processSalesLines(lines)
      computedSubtotal = processed.subtotal
      computedTax = processed.taxAmount
      computedTotal = processed.total
    } else if (!computedTotal) {
      return Response.json({ error: 'lines or total are required' }, { status: 400 })
    }

    const receiptNo = await getNextSequence('SALES_RECEIPT', 'SR-')
    const resolvedCurrency = await resolveTransactionCurrency(currency)

    const { data: receipt, error } = await client
      .from('sales_receipts')
      .insert({
        company_id: companyId,
        receipt_no: receiptNo,
        customer_id: customerId ?? null,
        date: new Date(date).toISOString(),
        currency: resolvedCurrency,
        subtotal: computedSubtotal,
        tax_amount: computedTax,
        total: computedTotal,
        payment_method: paymentMethod ?? 'CASH',
        notes: notes ?? null,
      })
      .select('*')
      .single()

    if (error) throw error
    return Response.json(mapSalesReceipt(receipt), { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
