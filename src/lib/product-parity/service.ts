import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNextSequence } from '@/lib/sequences'
import { postSourceDocumentToLedger, findSystemAccount } from '@/lib/accounting/posting-service'
import { processInventoryMovement } from '@/lib/inventory/movements'
import { calculateBillableMargin, calculateRefund, money, requiredText, validDate } from './validation'
import { buildCreditCardPaymentPostingLines, buildRefundPostingLines, buildTaxSettlementPostingLines } from './accounting'
import { resolvePaymentMethod } from './payment-methods'

type Row = Record<string, unknown>

async function companyRecord(client: ReturnType<typeof createAdminClient>, table: string, id: string, companyId: string, select = '*') {
  const { data, error } = await client.from(table).select(select).eq('id', id).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`${table.replaceAll('_', ' ')} record not found.`)
  return data as unknown as Row
}

async function adjustBankBalance(client: ReturnType<typeof createAdminClient>, companyId: string, id: string, delta: number) {
  const account = await companyRecord(client, 'bank_accounts', id, companyId, 'current_balance')
  const { error } = await client.from('bank_accounts').update({ current_balance: Number(account.current_balance ?? 0) + delta, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId)
  if (error) throw error
}

export async function createRefundReceipt(companyId: string, userId: string, input: Row) {
  const client = createAdminClient()
  const customerId = requiredText(input.customerId, 'Customer')
  const bankAccountId = requiredText(input.bankAccountId, 'Bank account')
  const reason = requiredText(input.reason, 'Reason')
  const date = validDate(input.date, 'Date')
  const calculated = calculateRefund(input.lines)
  const paymentMethod = await resolvePaymentMethod(companyId, requiredText(input.paymentMethodId, 'Payment method'))
  for (const accountId of new Set(calculated.lines.map(line => line.accountId).filter(Boolean))) await companyRecord(client, 'chart_of_accounts', String(accountId), companyId, 'id')
  for (const itemId of new Set(calculated.lines.map(line => line.inventoryItemId).filter(Boolean))) await companyRecord(client, 'inventory_items', String(itemId), companyId, 'id')
  for (const centerId of new Set(calculated.lines.map(line => line.costCenterId).filter(Boolean))) await companyRecord(client, 'cost_centers', String(centerId), companyId, 'id')
  const customer = await companyRecord(client, 'customers', customerId, companyId, 'id')
  const bank = await companyRecord(client, 'bank_accounts', bankAccountId, companyId, 'id,account_id,currency')
  if (!bank.account_id) throw new Error('The selected bank account is not linked to a Chart of Accounts account.')
  if (input.sourceInvoiceId) {
    const invoice = await companyRecord(client, 'invoices', String(input.sourceInvoiceId), companyId, 'id,customer_id,total')
    if (invoice.customer_id !== customer.id) throw new Error('Refund customer must match the source invoice customer.')
    const { data: prior } = await client.from('refund_receipts').select('total').eq('company_id', companyId).eq('source_invoice_id', invoice.id).eq('status', 'POSTED').is('deleted_at', null)
    const alreadyRefunded = (prior ?? []).reduce((sum, row) => sum + Number(row.total), 0)
    if (alreadyRefunded + calculated.total > Number(invoice.total) + 0.01) throw new Error('Refund total exceeds the refundable amount on the source invoice.')
    const sourceLineIds = calculated.lines.map(line => line.sourceInvoiceLineId).filter(Boolean).map(String)
    if (sourceLineIds.length) {
      const { data: sourceLines, error: sourceLineError } = await client.from('invoice_lines').select('id').eq('company_id', companyId).eq('invoice_id', invoice.id).in('id', sourceLineIds)
      if (sourceLineError) throw sourceLineError
      if ((sourceLines?.length ?? 0) !== new Set(sourceLineIds).size) throw new Error('A refund line does not belong to the source invoice.')
    }
  }
  const refundNo = await getNextSequence('REFUND_RECEIPT', 'RR-')
  const currency = String(input.currency ?? bank.currency ?? 'SAR')
  const { data: receipt, error } = await client.from('refund_receipts').insert({
    company_id: companyId, refund_no: refundNo, customer_id: customerId,
    source_invoice_id: input.sourceInvoiceId ?? null, bank_account_id: bankAccountId,
    payment_method_id: paymentMethod.id, date: date.toISOString(), currency,
    status: 'POSTED', subtotal: calculated.subtotal, tax_amount: calculated.taxAmount,
    total: calculated.total, reason, reference: input.reference ?? null, created_by_id: userId, posted_at: new Date().toISOString(),
  }).select('*').single()
  if (error) throw error
  try {
    const { data: savedLines, error: lineError } = await client.from('refund_receipt_lines').insert(calculated.lines.map((line) => ({
      company_id: companyId, refund_receipt_id: receipt.id, source_invoice_line_id: line.sourceInvoiceLineId,
      account_id: line.accountId, inventory_item_id: line.inventoryItemId, cost_center_id: line.costCenterId,
      description: line.description, quantity: line.quantity, unit_price: line.unitPrice, tax_rate: line.taxRate,
      amount: money(line.quantity * line.unitPrice, 'Line amount'),
    }))).select('*')
    if (lineError) throw lineError
    const defaultRevenue = calculated.lines.some((line) => !line.accountId) ? await findSystemAccount(companyId, { canonicalType: 'Income' }) : null
    const tax = calculated.taxAmount > 0 ? await findSystemAccount(companyId, { nameContains: 'VAT Payable' }) : null
    if (calculated.lines.some((line) => !line.accountId) && !defaultRevenue) throw new Error('A revenue account is required to post the refund.')
    if (calculated.taxAmount > 0 && !tax) throw new Error('A VAT Payable account is required to reverse refund tax.')
    const revenueGroups = new Map<string, { accountId: string; amount: number; costCenterId: string | null }>()
    for (const line of calculated.lines) {
      const accountId = line.accountId ?? defaultRevenue!
      const key = `${accountId}:${line.costCenterId ?? ''}`
      const current = revenueGroups.get(key) ?? { accountId, amount: 0, costCenterId: line.costCenterId ?? null }
      current.amount += money(line.quantity * line.unitPrice, 'Line amount')
      revenueGroups.set(key, current)
    }
    const posting = buildRefundPostingLines({ revenueLines: [...revenueGroups.values()].map(value => ({ ...value, amount: money(value.amount, 'Revenue reversal') })), taxAccountId: tax, bankAccountId: String(bank.account_id), taxAmount: calculated.taxAmount, total: calculated.total, reference: refundNo })
    await postSourceDocumentToLedger({ companyId, sourceType: 'REFUND_RECEIPT', sourceId: receipt.id, entryDate: date, description: `Refund receipt ${refundNo}`, currency, lines: posting, userId })
    const { error: bankTransactionError } = await client.from('bank_transactions').insert({ company_id: companyId, bank_account_id: bankAccountId, transaction_date: date.toISOString(), description: `Refund ${refundNo}`, reference: input.reference ?? refundNo, amount: calculated.total, type: 'DEBIT', status: 'MATCHED', imported_from: 'REFUND_RECEIPT', source_type: 'REFUND_RECEIPT', source_id: receipt.id })
    if (bankTransactionError) throw bankTransactionError
    await adjustBankBalance(client, companyId, bankAccountId, -calculated.total)
    for (const line of calculated.lines.filter((value) => value.inventoryItemId)) {
      await processInventoryMovement({ companyId, inventoryItemId: line.inventoryItemId!, movementType: 'RECEIPT', quantity: line.quantity, sourceType: 'REFUND_RECEIPT', sourceId: receipt.id, reason, userId })
    }
    return { ...receipt, lines: savedLines ?? [] }
  } catch (cause) {
    await client.from('refund_receipt_lines').delete().eq('refund_receipt_id', receipt.id).eq('company_id', companyId)
    await client.from('refund_receipts').delete().eq('id', receipt.id).eq('company_id', companyId)
    throw cause
  }
}

export async function voidRefundReceipt(companyId: string, userId: string, refundId: string, input: Row) {
  const client = createAdminClient()
  const receipt = await companyRecord(client, 'refund_receipts', refundId, companyId, '*')
  if (String(receipt.status) !== 'POSTED') throw new Error('Only a posted refund receipt can be voided.')
  const reason = requiredText(input.reason, 'Void reason')
  const date = validDate(input.date ?? new Date().toISOString(), 'Void date')
  const bank = await companyRecord(client, 'bank_accounts', String(receipt.bank_account_id), companyId, 'id,account_id,currency')
  if (!bank.account_id) throw new Error('The refund bank account is no longer linked to Chart of Accounts.')
  const { data: originalLedger, error: ledgerError } = await client.from('ledger_entries').select('account_id,debit,credit,cost_center_id').eq('company_id', companyId).eq('source_type', 'REFUND_RECEIPT').eq('source_id', refundId)
  if (ledgerError) throw ledgerError
  if (!originalLedger?.length) throw new Error('Original refund ledger posting was not found.')
  const reversal = originalLedger.map(line => ({ accountId: String(line.account_id), debit: Number(line.credit ?? 0), credit: Number(line.debit ?? 0), costCenterId: line.cost_center_id as string | null, description: `Void ${String(receipt.refund_no)}: ${reason}` }))
  await postSourceDocumentToLedger({ companyId, sourceType: 'REFUND_RECEIPT_VOID', sourceId: refundId, entryDate: date, description: `Void refund ${String(receipt.refund_no)}`, currency: String(receipt.currency), lines: reversal, userId, reason })
  const { error: bankError } = await client.from('bank_transactions').insert({ company_id: companyId, bank_account_id: bank.id, transaction_date: date.toISOString(), description: `Void refund ${String(receipt.refund_no)}`, reference: String(receipt.refund_no), amount: Number(receipt.total), type: 'CREDIT', status: 'MATCHED', imported_from: 'REFUND_RECEIPT_VOID', source_type: 'REFUND_RECEIPT_VOID', source_id: refundId })
  if (bankError) throw bankError
  await adjustBankBalance(client, companyId, String(bank.id), Number(receipt.total))
  const { data: lines, error: lineError } = await client.from('refund_receipt_lines').select('inventory_item_id,quantity').eq('company_id', companyId).eq('refund_receipt_id', refundId)
  if (lineError) throw lineError
  for (const line of (lines ?? []).filter(row => row.inventory_item_id)) {
    await processInventoryMovement({ companyId, inventoryItemId: String(line.inventory_item_id), movementType: 'ISSUE', quantity: Number(line.quantity), sourceType: 'REFUND_RECEIPT_VOID', sourceId: refundId, reason, userId, postCogsJournal: false })
  }
  const { data: updated, error: updateError } = await client.from('refund_receipts').update({ status: 'VOID', updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', refundId).eq('status', 'POSTED').select('*').single()
  if (updateError) throw updateError
  return updated
}

export async function createTimeActivity(companyId: string, userId: string, input: Row) {
  const client = createAdminClient()
  const employeeId = typeof input.employeeId === 'string' && input.employeeId ? input.employeeId : null
  const vendorId = typeof input.vendorId === 'string' && input.vendorId ? input.vendorId : null
  if ((employeeId ? 1 : 0) + (vendorId ? 1 : 0) !== 1) throw new Error('Select exactly one employee or vendor.')
  if (employeeId) await companyRecord(client, 'employees', employeeId, companyId, 'id')
  if (vendorId) await companyRecord(client, 'vendors', vendorId, companyId, 'id')
  const isBillable = Boolean(input.isBillable)
  const customerId = typeof input.customerId === 'string' && input.customerId ? input.customerId : null
  if (isBillable && !customerId) throw new Error('Billable time requires a customer.')
  if (customerId) await companyRecord(client, 'customers', customerId, companyId, 'id')
  if (input.projectId) {
    const project = await companyRecord(client, 'cost_centers', String(input.projectId), companyId, 'id,type')
    if (String(project.type) !== 'PROJECT') throw new Error('Time activities can only link to a project cost center.')
  }
  if (input.serviceItemId) await companyRecord(client, 'inventory_items', String(input.serviceItemId), companyId, 'id')
  const hours = money(input.hours, 'Hours', { positive: true })
  if (hours > 24) throw new Error('Hours cannot exceed 24 for one activity.')
  const costRate = money(input.costRate ?? 0, 'Cost rate', { positive: true, allowZero: true })
  const billingRate = money(input.billingRate ?? 0, 'Billing rate', { positive: true, allowZero: true })
  if (input.payrollEntryId) {
    if (!employeeId) throw new Error('Only employee time can be linked to payroll.')
    const payroll = await companyRecord(client, 'payroll_entries', String(input.payrollEntryId), companyId, 'id,employee_id,status')
    if (String(payroll.employee_id) !== employeeId) throw new Error('Payroll entry employee must match the time activity employee.')
    if (!['DRAFT', 'PENDING'].includes(String(payroll.status))) throw new Error('Only an open payroll entry can receive time activities.')
  }
  const activityNo = await getNextSequence('TIME_ACTIVITY', 'TIME-')
  const { data, error } = await client.from('time_activities').insert({
    company_id: companyId, activity_no: activityNo, activity_date: validDate(input.date, 'Date').toISOString(),
    employee_id: employeeId, vendor_id: vendorId, customer_id: customerId, project_id: input.projectId ?? null,
    service_item_id: input.serviceItemId ?? null, description: requiredText(input.description, 'Description'), hours,
    cost_rate: costRate, billing_rate: billingRate, is_billable: isBillable, status: input.status ?? 'APPROVED',
    payroll_entry_id: input.payrollEntryId ?? null, created_by_id: userId,
  }).select('*').single()
  if (error) throw error
  if (input.payrollEntryId && employeeId) {
    const payrollAmount = money(hours * costRate, 'Payroll amount')
    const { error: payrollError } = await client.from('payroll_lines').insert({ company_id: companyId, payroll_id: input.payrollEntryId, type: 'EARNING', description: `Time ${activityNo}: ${data.description}`, amount: payrollAmount })
    if (payrollError) throw payrollError
    const payroll = await companyRecord(client, 'payroll_entries', String(input.payrollEntryId), companyId, 'allowances,net_salary')
    const { error: payrollUpdateError } = await client.from('payroll_entries').update({ allowances: Number(payroll.allowances ?? 0) + payrollAmount, net_salary: Number(payroll.net_salary ?? 0) + payrollAmount, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', input.payrollEntryId)
    if (payrollUpdateError) throw payrollUpdateError
  }
  return data
}

export async function markExpenseBillable(companyId: string, expenseId: string, input: Row) {
  const client = createAdminClient()
  const customerId = requiredText(input.customerId, 'Customer')
  await companyRecord(client, 'customers', customerId, companyId, 'id')
  const expense = await companyRecord(client, 'expenses', expenseId, companyId, 'id,status,billable_status')
  if (String(expense.status) !== 'APPROVED') throw new Error('Only approved expenses can be marked billable.')
  if (String(expense.billable_status) === 'INVOICED') throw new Error('This expense has already been invoiced.')
  if (input.projectId) {
    const project = await companyRecord(client, 'cost_centers', String(input.projectId), companyId, 'id,type')
    if (String(project.type) !== 'PROJECT') throw new Error('Billable expenses can only link to a project cost center.')
  }
  const { data, error } = await client.from('expenses').update({ customer_id: customerId, project_id: input.projectId ?? null, is_billable: true, billable_status: 'UNBILLED', markup_percent: money(input.markupPercent ?? 0, 'Markup', { positive: true, allowZero: true }) }).eq('id', expenseId).eq('company_id', companyId).is('deleted_at', null).select('*').single()
  if (error) throw error
  return data
}

export async function invoiceBillableCharges(companyId: string, userId: string, input: Row) {
  const client = createAdminClient()
  const customerId = requiredText(input.customerId, 'Customer')
  const timeIds = Array.isArray(input.timeActivityIds) ? input.timeActivityIds.map(String) : []
  const expenseIds = Array.isArray(input.expenseIds) ? input.expenseIds.map(String) : []
  if (timeIds.length + expenseIds.length === 0) throw new Error('Select at least one billable time activity or expense.')
  const { data: times, error: timeError } = timeIds.length ? await client.from('time_activities').select('*').eq('company_id', companyId).eq('customer_id', customerId).eq('is_billable', true).eq('status', 'APPROVED').in('id', timeIds) : { data: [], error: null }
  if (timeError) throw timeError
  const { data: expenses, error: expenseError } = expenseIds.length ? await client.from('expenses').select('*').eq('company_id', companyId).eq('customer_id', customerId).eq('is_billable', true).eq('billable_status', 'UNBILLED').in('id', expenseIds) : { data: [], error: null }
  if (expenseError) throw expenseError
  if ((times?.length ?? 0) !== timeIds.length || (expenses?.length ?? 0) !== expenseIds.length) throw new Error('One or more selected charges are unavailable or belong to another customer.')
  const revenue = await findSystemAccount(companyId, { canonicalType: 'Income' })
  if (!revenue) throw new Error('An income account is required for billable charges.')
  const lines = [
    ...(times ?? []).map((row) => ({ source: 'time' as const, id: String(row.id), description: String(row.description), quantity: Number(row.hours), unitPrice: Number(row.billing_rate), cost: Number(row.hours) * Number(row.cost_rate), projectId: row.project_id as string | null })),
    ...(expenses ?? []).map((row) => { const cost = Number(row.total); const billed = cost * (1 + Number(row.markup_percent ?? 0) / 100); return { source: 'expense' as const, id: String(row.id), description: `Billable expense ${String(row.expense_no)}`, quantity: 1, unitPrice: billed, cost, projectId: row.project_id as string | null } }),
  ]
  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), 'Subtotal')
  const taxRate = money(input.taxRate ?? 0, 'Tax rate', { positive: true, allowZero: true })
  const taxAmount = money(subtotal * taxRate / 100, 'Tax')
  const total = subtotal + taxAmount
  const invoiceNo = await getNextSequence('INVOICE', 'INV-')
  const date = validDate(input.date ?? new Date().toISOString(), 'Invoice date')
  const dueDate = validDate(input.dueDate ?? date, 'Due date')
  const { data: invoice, error } = await client.from('invoices').insert({ company_id: companyId, invoice_no: invoiceNo, customer_id: customerId, date: date.toISOString(), due_date: dueDate.toISOString(), currency: input.currency ?? 'SAR', status: 'DRAFT', subtotal, tax_amount: taxAmount, total, balance: total, notes: input.notes ?? 'Generated from billable charges', created_by_id: userId }).select('*').single()
  if (error) throw error
  try {
    const { data: invoiceLines, error: linesError } = await client.from('invoice_lines').insert(lines.map((line) => ({ company_id: companyId, invoice_id: invoice.id, account_id: revenue, cost_center_id: line.projectId, description: line.description, quantity: line.quantity, unit_price: line.unitPrice, tax_rate: taxRate, amount: money(line.quantity * line.unitPrice, 'Line amount') }))).select('*')
    if (linesError) throw linesError
    const links = lines.map((line, index) => ({ company_id: companyId, invoice_id: invoice.id, invoice_line_id: invoiceLines![index].id, time_activity_id: line.source === 'time' ? line.id : null, expense_id: line.source === 'expense' ? line.id : null, cost_amount: line.cost, billed_amount: line.quantity * line.unitPrice }))
    const { error: linkError } = await client.from('billable_charge_links').insert(links)
    if (linkError) throw linkError
    if (timeIds.length) await client.from('time_activities').update({ status: 'INVOICED', invoice_id: invoice.id }).eq('company_id', companyId).in('id', timeIds)
    if (expenseIds.length) await client.from('expenses').update({ billable_status: 'INVOICED', billed_invoice_id: invoice.id }).eq('company_id', companyId).in('id', expenseIds)
    const cost = lines.reduce((sum, line) => sum + line.cost, 0)
    return { invoice, margin: calculateBillableMargin(cost, subtotal) }
  } catch (cause) {
    await client.from('invoices').delete().eq('id', invoice.id).eq('company_id', companyId)
    throw cause
  }
}

export async function createCreditCardPayment(companyId: string, userId: string, input: Row) {
  const client = createAdminClient()
  const bankId = requiredText(input.bankAccountId, 'Bank account')
  const cardId = requiredText(input.creditCardAccountId, 'Credit card account')
  if (bankId === cardId) throw new Error('Bank and credit-card accounts must differ.')
  const bank = await companyRecord(client, 'bank_accounts', bankId, companyId, 'id,account_id,current_balance,currency,account_type')
  const card = await companyRecord(client, 'bank_accounts', cardId, companyId, 'id,account_id,current_balance,currency,account_type')
  if (!bank.account_id || !card.account_id) throw new Error('Both accounts must be linked to Chart of Accounts accounts.')
  if (String(bank.account_type).toUpperCase() === 'CREDIT_CARD') throw new Error('The funding account must be a bank or cash account.')
  if (String(card.account_type).toUpperCase() !== 'CREDIT_CARD') throw new Error('Destination must be a credit-card account.')
  if (String(bank.currency) !== String(card.currency)) throw new Error('Bank and credit-card accounts must use the same currency for a pay-down.')
  const amount = money(input.amount, 'Amount', { positive: true })
  const feeAmount = money(input.feeAmount ?? 0, 'Fee', { positive: true, allowZero: true })
  const feeAccountId = feeAmount > 0 ? requiredText(input.feeAccountId, 'Fee account') : null
  const paymentMethod = await resolvePaymentMethod(companyId, requiredText(input.paymentMethodId, 'Payment method'))
  if (feeAccountId) await companyRecord(client, 'chart_of_accounts', feeAccountId, companyId, 'id')
  const paymentNo = await getNextSequence('CREDIT_CARD_PAYMENT', 'CCP-')
  const date = validDate(input.date, 'Date')
  const { data: payment, error } = await client.from('credit_card_payments').insert({ company_id: companyId, payment_no: paymentNo, date: date.toISOString(), bank_account_id: bankId, credit_card_account_id: cardId, payment_method_id: paymentMethod.id, amount, fee_amount: feeAmount, fee_account_id: feeAccountId, currency: input.currency ?? bank.currency ?? 'SAR', reference: input.reference ?? null, status: 'POSTED', created_by_id: userId }).select('*').single()
  if (error) throw error
  const lines = buildCreditCardPaymentPostingLines({ cardAccountId: String(card.account_id), bankAccountId: String(bank.account_id), feeAccountId, amount, feeAmount, reference: paymentNo })
  try {
    await postSourceDocumentToLedger({ companyId, sourceType: 'CREDIT_CARD_PAYMENT', sourceId: payment.id, entryDate: date, description: `Credit-card payment ${paymentNo}`, currency: String(payment.currency), lines, userId })
    const { error: bankTransactionError } = await client.from('bank_transactions').insert([
      { company_id: companyId, bank_account_id: bankId, transaction_date: date.toISOString(), description: `Credit-card payment ${paymentNo}`, reference: input.reference ?? paymentNo, amount: amount + feeAmount, type: 'DEBIT', status: 'MATCHED', imported_from: 'CREDIT_CARD_PAYMENT', source_type: 'CREDIT_CARD_PAYMENT', source_id: payment.id },
      { company_id: companyId, bank_account_id: cardId, transaction_date: date.toISOString(), description: `Payment received ${paymentNo}`, reference: input.reference ?? paymentNo, amount, type: 'CREDIT', status: 'MATCHED', imported_from: 'CREDIT_CARD_PAYMENT', source_type: 'CREDIT_CARD_PAYMENT', source_id: payment.id },
    ])
    if (bankTransactionError) throw bankTransactionError
    await adjustBankBalance(client, companyId, bankId, -(amount + feeAmount))
    await adjustBankBalance(client, companyId, cardId, amount)
    return payment
  } catch (cause) {
    await client.from('credit_card_payments').delete().eq('id', payment.id).eq('company_id', companyId)
    throw cause
  }
}

export async function createTaxFilingPeriod(companyId: string, input: Row) {
  const client = createAdminClient()
  const agencyId = requiredText(input.taxAgencyId, 'Tax agency')
  const agency = await companyRecord(client, 'tax_agencies', agencyId, companyId, 'id,liability_account_id,receivable_account_id')
  const start = validDate(input.periodStart, 'Period start'); const end = validDate(input.periodEnd, 'Period end')
  if (end < start) throw new Error('Period end must be on or after period start.')
  const accountIds = [agency.liability_account_id, agency.receivable_account_id].filter(Boolean).map(String)
  const { data: ledger, error: ledgerError } = await client.from('ledger_entries').select('account_id,debit,credit').eq('company_id', companyId).in('account_id', accountIds).gte('entry_date', start.toISOString()).lte('entry_date', end.toISOString())
  if (ledgerError) throw ledgerError
  const taxCollected = (ledger ?? []).filter((row) => row.account_id === agency.liability_account_id).reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0)
  const taxPaid = (ledger ?? []).filter((row) => row.account_id === agency.receivable_account_id).reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)
  const { data, error } = await client.from('tax_filing_periods').insert({ company_id: companyId, tax_agency_id: agencyId, period_start: start.toISOString(), period_end: end.toISOString(), due_date: validDate(input.dueDate, 'Due date').toISOString(), tax_collected: taxCollected, tax_paid: taxPaid, net_due: taxCollected - taxPaid, status: input.status ?? 'OPEN' }).select('*').single()
  if (error) throw error
  return data
}

export async function createTaxSettlement(companyId: string, userId: string, input: Row) {
  const client = createAdminClient()
  const agency = await companyRecord(client, 'tax_agencies', requiredText(input.taxAgencyId, 'Tax agency'), companyId, 'id,liability_account_id,receivable_account_id')
  const bank = await companyRecord(client, 'bank_accounts', requiredText(input.bankAccountId, 'Bank account'), companyId, 'id,account_id,current_balance,currency')
  if (!bank.account_id) throw new Error('Bank account must be linked to a Chart of Accounts account.')
  const type = input.type === 'REFUND' ? 'REFUND' : 'PAYMENT'
  const amount = money(input.amount, 'Amount', { positive: true })
  const settlementNo = await getNextSequence('TAX_SETTLEMENT', type === 'PAYMENT' ? 'TAXP-' : 'TAXR-')
  const date = validDate(input.date, 'Date')
  const { data, error } = await client.from('tax_settlements').insert({ company_id: companyId, settlement_no: settlementNo, tax_agency_id: agency.id, filing_period_id: input.filingPeriodId ?? null, bank_account_id: bank.id, date: date.toISOString(), settlement_type: type, amount, reference: input.reference ?? null, status: 'POSTED', created_by_id: userId }).select('*').single()
  if (error) throw error
  const controlId = type === 'PAYMENT' ? agency.liability_account_id : (agency.receivable_account_id ?? agency.liability_account_id)
  const lines = buildTaxSettlementPostingLines({ type, taxAccountId: String(controlId), bankAccountId: String(bank.account_id), amount, reference: settlementNo })
  await postSourceDocumentToLedger({ companyId, sourceType: type === 'PAYMENT' ? 'TAX_PAYMENT' : 'TAX_REFUND', sourceId: data.id, entryDate: date, description: `${type === 'PAYMENT' ? 'Tax payment' : 'Tax refund'} ${settlementNo}`, currency: String(bank.currency ?? 'SAR'), lines, userId })
  const { error: bankTransactionError } = await client.from('bank_transactions').insert({ company_id: companyId, bank_account_id: bank.id, transaction_date: date.toISOString(), description: `${type === 'PAYMENT' ? 'Tax payment' : 'Tax refund'} ${settlementNo}`, reference: input.reference ?? settlementNo, amount, type: type === 'PAYMENT' ? 'DEBIT' : 'CREDIT', status: 'MATCHED', imported_from: type === 'PAYMENT' ? 'TAX_PAYMENT' : 'TAX_REFUND', source_type: type === 'PAYMENT' ? 'TAX_PAYMENT' : 'TAX_REFUND', source_id: data.id })
  if (bankTransactionError) throw bankTransactionError
  await adjustBankBalance(client, companyId, String(bank.id), type === 'PAYMENT' ? -amount : amount)
  if (input.filingPeriodId) await client.from('tax_filing_periods').update({ status: 'PAID' }).eq('id', input.filingPeriodId).eq('company_id', companyId)
  return data
}

export async function reconcileCreditCardPayment(companyId: string, paymentId: string) {
  const client = createAdminClient()
  const payment = await companyRecord(client, 'credit_card_payments', paymentId, companyId, 'id,status,reconciliation_status')
  if (String(payment.status) !== 'POSTED') throw new Error('Only posted card payments can be reconciled.')
  const { data: transactions, error: transactionError } = await client.from('bank_transactions').select('id').eq('company_id', companyId).eq('source_type', 'CREDIT_CARD_PAYMENT').eq('source_id', paymentId)
  if (transactionError) throw transactionError
  if ((transactions?.length ?? 0) !== 2) throw new Error('Both sides of the card payment must exist before reconciliation.')
  const { error: bankUpdateError } = await client.from('bank_transactions').update({ status: 'RECONCILED' }).eq('company_id', companyId).eq('source_type', 'CREDIT_CARD_PAYMENT').eq('source_id', paymentId)
  if (bankUpdateError) throw bankUpdateError
  const { data, error } = await client.from('credit_card_payments').update({ reconciliation_status: 'RECONCILED', updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', paymentId).select('*').single()
  if (error) throw error
  return data
}
