import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getCurrencyRoles, getCurrencySettings } from '@/lib/currency/fx-accounts'
import { getExchangeRateAtDate } from '@/lib/currency/exchange-rates'
import { computeRealizedFxDifference } from '@/lib/currency/fx-conversion'
import { postGoodsReceiptFromBill, postGoodsIssueFromInvoice } from '@/lib/inventory/document-hooks'
import { buildTaxJournalLines } from '@/lib/tax/journal-posting'
import { findSystemAccount, postSourceDocumentToLedger } from './posting-service'
import type { PostingLine } from './posting-service'

function roundMoney(v: number) { return Math.round(v * 10000) / 10000 }

async function getAccountIds(companyId: string) {
  const ar = await findSystemAccount(companyId, { nameContains: 'Receivable', canonicalType: 'Asset' })
  const ap = await findSystemAccount(companyId, { nameContains: 'Payable', canonicalType: 'Liability' })
  const revenue = await findSystemAccount(companyId, { accountNoPrefix: '41', canonicalType: 'Income' })
  const vatPayable = await findSystemAccount(companyId, { nameContains: 'VAT Payable' })
  const vatReceivable = await findSystemAccount(companyId, { nameContains: 'VAT Receivable' })
  const bank = await findSystemAccount(companyId, { accountNoPrefix: '11-1101' })
  const expense = await findSystemAccount(companyId, { accountNoPrefix: '61' })
  const salaries = await findSystemAccount(companyId, { nameContains: 'Salaries' })
  return { ar, ap, revenue, vatPayable, vatReceivable, bank, expense, salaries }
}

async function storeDocumentBaseAmounts(
  table: 'invoices' | 'bills',
  id: string,
  companyId: string,
  currency: string,
  entryDate: Date,
  subtotal: number,
  taxAmount: number,
  total: number,
) {
  const roles = await getCurrencyRoles(companyId)
  const rate = await getExchangeRateAtDate(currency, roles.baseCurrency, entryDate, companyId)
  const client = createAdminClient()
  await client
    .from(table)
    .update({
      exchange_rate: rate,
      base_subtotal: subtotal * rate,
      base_tax_amount: taxAmount * rate,
      base_total: total * rate,
    })
    .eq('id', id)
    .eq('company_id', companyId)
  return rate
}

export async function postInvoiceToLedger(invoiceId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const accounts = await getAccountIds(cid)

  const { data: invoice, error } = await client
    .from('invoices')
    .select('*, lines:invoice_lines(*)')
    .eq('id', invoiceId)
    .eq('company_id', cid)
    .single()

  if (error || !invoice) throw new Error('Invoice not found')
  if (!['SENT', 'PAID', 'PARTIAL'].includes(String(invoice.status))) return

  const currency = String(invoice.currency ?? 'SAR')
  const entryDate = new Date(String(invoice.date))
  const subtotal = Number(invoice.subtotal)
  const taxAmount = Number(invoice.tax_amount)
  const total = Number(invoice.total)

  const exchangeRate = await storeDocumentBaseAmounts(
    'invoices', invoiceId, cid, currency, entryDate, subtotal, taxAmount, total,
  )

  const lines: PostingLine[] = []
  const arAccount = accounts.ar
  const revenueAccount = accounts.revenue

  if (arAccount && total > 0) {
    lines.push({
      accountId: arAccount,
      debit: total,
      description: `Invoice ${invoice.invoice_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }
  if (revenueAccount && subtotal > 0) {
    lines.push({
      accountId: revenueAccount,
      credit: subtotal,
      description: `Revenue ${invoice.invoice_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }

  const taxComponents = taxAmount > 0
    ? [{
        name: 'VAT',
        rate: subtotal > 0 ? roundMoney((taxAmount / subtotal) * 100) : 15,
        taxMode: 'EXCLUSIVE' as const,
        taxableAmount: subtotal,
        taxAmount,
        isReverseCharge: false,
        isWithholding: false,
      }]
    : []

  const taxLines = await buildTaxJournalLines({
    companyId: cid,
    documentNo: String(invoice.invoice_no),
    documentType: 'INVOICE',
    isSales: true,
    components: taxComponents,
  })
  for (const tl of taxLines) {
    lines.push({ ...tl, exchangeRateOverride: exchangeRate })
  }

  if (lines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'INVOICE',
      sourceId: invoiceId,
      entryDate,
      description: `Invoice ${invoice.invoice_no}`,
      currency,
      lines,
    })
    await postGoodsIssueFromInvoice(invoiceId, cid)
  }
}

export async function postBillToLedger(billId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const accounts = await getAccountIds(cid)

  const { data: bill, error } = await client
    .from('bills')
    .select('*')
    .eq('id', billId)
    .eq('company_id', cid)
    .single()

  if (error || !bill) throw new Error('Bill not found')
  if (!['RECEIVED', 'PAID', 'PARTIAL'].includes(String(bill.status))) return

  const currency = String(bill.currency ?? 'SAR')
  const entryDate = new Date(String(bill.date))
  const subtotal = Number(bill.subtotal)
  const taxAmount = Number(bill.tax_amount)
  const total = Number(bill.total)

  const exchangeRate = await storeDocumentBaseAmounts(
    'bills', billId, cid, currency, entryDate, subtotal, taxAmount, total,
  )

  const lines: PostingLine[] = []
  const expenseAccount = accounts.expense
  const apAccount = accounts.ap

  if (expenseAccount && subtotal > 0) {
    lines.push({
      accountId: expenseAccount,
      debit: subtotal,
      description: `Bill ${bill.bill_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }

  if (taxAmount > 0) {
    const taxLines = await buildTaxJournalLines({
      companyId: cid,
      documentNo: String(bill.bill_no),
      documentType: 'BILL',
      isSales: false,
      components: [{
        name: 'VAT',
        rate: 15,
        taxMode: 'EXCLUSIVE',
        taxableAmount: subtotal,
        taxAmount,
        isReverseCharge: false,
        isWithholding: false,
      }],
    })
    for (const tl of taxLines) {
      lines.push({ ...tl, exchangeRateOverride: exchangeRate })
    }
  }

  if (apAccount && total > 0) {
    lines.push({
      accountId: apAccount,
      credit: total,
      description: `Bill ${bill.bill_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }

  if (lines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'BILL',
      sourceId: billId,
      entryDate,
      description: `Bill ${bill.bill_no}`,
      currency,
      lines,
    })
    await postGoodsReceiptFromBill(billId, cid)
  }
}

export async function postPaymentToLedger(paymentId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const accounts = await getAccountIds(cid)
  const fxSettings = await getCurrencySettings(cid)

  const { data: payment, error } = await client
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .eq('company_id', cid)
    .single()

  if (error || !payment) throw new Error('Payment not found')

  const currency = String(payment.currency ?? 'SAR')
  const entryDate = new Date(String(payment.date))
  const amount = Number(payment.amount)
  const roles = await getCurrencyRoles(cid)
  const paymentRate = await getExchangeRateAtDate(currency, roles.baseCurrency, entryDate, cid)

  await client
    .from('payments')
    .update({
      exchange_rate: paymentRate,
      base_amount: amount * paymentRate,
    })
    .eq('id', paymentId)
    .eq('company_id', cid)

  const lines: PostingLine[] = []
  const bankAccount = accounts.bank

  let invoiceRate: number | null = null
  if (payment.invoice_id) {
    const { data: invoice } = await client
      .from('invoices')
      .select('exchange_rate, currency, invoice_no')
      .eq('id', payment.invoice_id)
      .eq('company_id', cid)
      .maybeSingle()
    invoiceRate = invoice?.exchange_rate ? Number(invoice.exchange_rate) : null

    if (bankAccount && accounts.ar) {
      lines.push({
        accountId: bankAccount,
        debit: amount,
        description: `Payment ${payment.payment_no}`,
        exchangeRateOverride: paymentRate,
      })
      lines.push({
        accountId: accounts.ar,
        credit: amount,
        description: `Payment ${payment.payment_no}`,
        exchangeRateOverride: invoiceRate ?? paymentRate,
      })

      if (invoiceRate && currency !== roles.baseCurrency) {
        const fxDiff = computeRealizedFxDifference({
          transactionAmount: amount,
          originalRate: invoiceRate,
          settlementRate: paymentRate,
        })
        if (Math.abs(fxDiff) > 0.01) {
          const gainAccount = fxSettings?.realizedGainAccountId
            ?? await findSystemAccount(cid, { nameContains: 'Realized FX Gain' })
          const lossAccount = fxSettings?.realizedLossAccountId
            ?? await findSystemAccount(cid, { nameContains: 'Realized FX Loss' })

          if (fxDiff > 0 && gainAccount) {
            lines.push({ accountId: gainAccount, credit: fxDiff, description: `Realized FX gain ${payment.payment_no}` })
          } else if (fxDiff < 0 && lossAccount) {
            lines.push({ accountId: lossAccount, debit: Math.abs(fxDiff), description: `Realized FX loss ${payment.payment_no}` })
          }
        }
      }
    }
  } else if (payment.bill_id && bankAccount && accounts.ap) {
    const { data: bill } = await client
      .from('bills')
      .select('exchange_rate, currency')
      .eq('id', payment.bill_id)
      .eq('company_id', cid)
      .maybeSingle()
    invoiceRate = bill?.exchange_rate ? Number(bill.exchange_rate) : null

    lines.push({
      accountId: accounts.ap,
      debit: amount,
      description: `Payment ${payment.payment_no}`,
      exchangeRateOverride: invoiceRate ?? paymentRate,
    })
    lines.push({
      accountId: bankAccount,
      credit: amount,
      description: `Payment ${payment.payment_no}`,
      exchangeRateOverride: paymentRate,
    })

    if (invoiceRate && currency !== roles.baseCurrency) {
      const fxDiff = computeRealizedFxDifference({
        transactionAmount: amount,
        originalRate: invoiceRate,
        settlementRate: paymentRate,
      })
      if (Math.abs(fxDiff) > 0.01) {
        const gainAccount = fxSettings?.realizedGainAccountId
          ?? await findSystemAccount(cid, { nameContains: 'Realized FX Gain' })
        const lossAccount = fxSettings?.realizedLossAccountId
          ?? await findSystemAccount(cid, { nameContains: 'Realized FX Loss' })

        if (fxDiff > 0 && lossAccount) {
          lines.push({ accountId: lossAccount, debit: fxDiff, description: `Realized FX loss ${payment.payment_no}` })
        } else if (fxDiff < 0 && gainAccount) {
          lines.push({ accountId: gainAccount, credit: Math.abs(fxDiff), description: `Realized FX gain ${payment.payment_no}` })
        }
      }
    }
  }

  if (lines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'PAYMENT',
      sourceId: paymentId,
      entryDate,
      description: `Payment ${payment.payment_no}`,
      currency,
      lines,
    })
  }
}

export async function postExpenseToLedger(expenseId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const accounts = await getAccountIds(cid)

  const { data: expense, error } = await client
    .from('expenses')
    .select('*, lines:expense_lines(*)')
    .eq('id', expenseId)
    .eq('company_id', cid)
    .single()

  if (error || !expense) throw new Error('Expense not found')
  if (!['APPROVED', 'PAID'].includes(String(expense.status))) return

  const currency = String(expense.currency ?? 'SAR')
  const entryDate = new Date(String(expense.date))
  const exchangeRate = await getExchangeRateAtDate(currency, (await getCurrencyRoles(cid)).baseCurrency, entryDate, cid)

  const lines: PostingLine[] = []
  const expenseAccount = accounts.expense
  const bankAccount = accounts.bank
  const total = Number(expense.total)

  if (expenseAccount && total > 0) {
    lines.push({
      accountId: expenseAccount,
      debit: total,
      description: `Expense ${expense.expense_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }
  if (bankAccount && total > 0) {
    lines.push({
      accountId: bankAccount,
      credit: total,
      description: `Expense ${expense.expense_no}`,
      exchangeRateOverride: exchangeRate,
    })
  }

  if (lines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'EXPENSE',
      sourceId: expenseId,
      entryDate,
      description: `Expense ${expense.expense_no}`,
      currency,
      lines,
    })
  }
}

export async function postPayrollToLedger(payrollId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const accounts = await getAccountIds(cid)

  const { data: payroll, error } = await client
    .from('payroll_entries')
    .select('*')
    .eq('id', payrollId)
    .eq('company_id', cid)
    .single()

  if (error || !payroll) throw new Error('Payroll not found')
  if (payroll.status !== 'APPROVED' && payroll.status !== 'PAID') return

  const lines: PostingLine[] = []
  const salariesAccount = accounts.salaries ?? accounts.expense
  const bankAccount = accounts.bank

  if (salariesAccount && Number(payroll.net_salary) > 0) {
    lines.push({ accountId: salariesAccount, debit: Number(payroll.net_salary), description: `Payroll ${payroll.payroll_no}` })
  }
  if (bankAccount && Number(payroll.net_salary) > 0) {
    lines.push({ accountId: bankAccount, credit: Number(payroll.net_salary), description: `Payroll ${payroll.payroll_no}` })
  }

  if (lines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'PAYROLL',
      sourceId: payrollId,
      entryDate: new Date(String(payroll.period_end)),
      description: `Payroll ${payroll.payroll_no}`,
      lines,
    })
  }
}
