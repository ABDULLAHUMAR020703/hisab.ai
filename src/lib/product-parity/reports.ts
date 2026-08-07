import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateBillableMargin } from './validation'

export async function buildProductParityReports(companyId: string, from: Date, to: Date) {
  const db = createAdminClient()
  const [refunds, time, links, cards, filings, settlements] = await Promise.all([
    db.from('refund_receipts').select('id,refund_no,date,subtotal,tax_amount,total,reason,customer:customers(name)').eq('company_id', companyId).gte('date', from.toISOString()).lte('date', to.toISOString()).is('deleted_at', null),
    db.from('time_activities').select('id,activity_no,activity_date,hours,cost_rate,billing_rate,is_billable,status,customer:customers(name),project:cost_centers(name)').eq('company_id', companyId).gte('activity_date', from.toISOString()).lte('activity_date', to.toISOString()).is('deleted_at', null),
    db.from('billable_charge_links').select('cost_amount,billed_amount').eq('company_id', companyId).gte('created_at', from.toISOString()).lte('created_at', to.toISOString()),
    db.from('credit_card_payments').select('id,payment_no,date,amount,fee_amount,status,reconciliation_status').eq('company_id', companyId).gte('date', from.toISOString()).lte('date', to.toISOString()).is('deleted_at', null),
    db.from('tax_filing_periods').select('*,agency:tax_agencies(name)').eq('company_id', companyId).gte('period_end', from.toISOString()).lte('period_end', to.toISOString()),
    db.from('tax_settlements').select('*,agency:tax_agencies(name)').eq('company_id', companyId).gte('date', from.toISOString()).lte('date', to.toISOString()),
  ])
  for (const result of [refunds,time,links,cards,filings,settlements]) if (result.error) throw result.error
  const cost = (links.data ?? []).reduce((sum, row) => sum + Number(row.cost_amount), 0)
  const billed = (links.data ?? []).reduce((sum, row) => sum + Number(row.billed_amount), 0)
  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    refunds: { rows: refunds.data ?? [], total: (refunds.data ?? []).reduce((sum, row) => sum + Number(row.total), 0) },
    billableWork: { rows: time.data ?? [], ...calculateBillableMargin(cost, billed) },
    creditCardPayments: { rows: cards.data ?? [], paid: (cards.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0), fees: (cards.data ?? []).reduce((sum, row) => sum + Number(row.fee_amount), 0) },
    tax: { filings: filings.data ?? [], settlements: settlements.data ?? [] },
  }
}
