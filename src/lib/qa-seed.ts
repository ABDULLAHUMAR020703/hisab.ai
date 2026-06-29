import 'server-only'
import { createHash, randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_COMPANY_ID } from '@/lib/supabase/env'

export interface QaSeedResult {
  status: 'seeded'
  customers: number
  inventory: number
  invoices: number
  vendors: number
  message: string
}

const COMPANY_ID = DEFAULT_COMPANY_ID

function invoiceHash(seed: string) {
  return createHash('sha256').update(seed).digest('hex')
}

async function ensureFoundation() {
  const db = createAdminClient()

  const { error: companyError } = await db.from('companies').upsert({
    id: COMPANY_ID,
    slug: 'netkom',
    company_name: 'NETKOM COMPANY FOR COMMUNICATION',
    legal_name: 'NETKOM COMPANY FOR COMMUNICATION',
    tax_id: '300123456700003',
    commercial_registration: '1010123456',
    street_address: 'King Fahd Road',
    building_number: '7845',
    district: 'Al Olaya',
    city: 'Riyadh',
    postal_code: '12211',
    country: 'Saudi Arabia',
    currency: 'SAR',
    fiscal_year_start: '01-01',
    is_active: true,
  }, { onConflict: 'id' })
  if (companyError) throw companyError

  const { error: settingsError } = await db.from('company_settings').upsert({
    company_id: COMPANY_ID,
  }, { onConflict: 'company_id' })
  if (settingsError) throw settingsError

  const { error: zatcaError } = await db.from('company_zatca_settings').upsert({
    company_id: COMPANY_ID,
  }, { onConflict: 'company_id' })
  if (zatcaError) throw zatcaError

  const { error: subscriptionError } = await db.from('company_subscriptions').upsert({
    company_id: COMPANY_ID,
    plan: 'FREE',
    status: 'TRIAL',
  }, { onConflict: 'company_id' })
  if (subscriptionError) throw subscriptionError
}

async function getSeedUserId() {
  const db = createAdminClient()
  const { data, error } = await db
    .from('company_users')
    .select('user_id')
    .eq('company_id', COMPANY_ID)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.user_id ?? null
}

async function upsertRows<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  onConflict: string,
) {
  const db = createAdminClient()
  const { data, error } = await db.from(table).upsert(rows as never[], { onConflict }).select('*')
  if (error) throw error
  return data ?? []
}

export async function seedQaData(): Promise<QaSeedResult> {
  await ensureFoundation()

  const now = new Date()
  const createdById = await getSeedUserId()

  const customers = await upsertRows('customers', [
    {
      company_id: COMPANY_ID,
      customer_no: 'CUST-001',
      name: 'Riyadh Telecom Buyer',
      email: 'ap@riyadh-telecom.example',
      phone: '+966112345001',
      street_address: 'King Fahd Road',
      building_number: '4321',
      district: 'Al Olaya',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      postal_code: '12211',
      tax_id: '399999999900003',
      payment_terms: 30,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      customer_no: 'CUST-002',
      name: 'Jeddah Retail Customer',
      email: 'finance@jeddah-retail.example',
      phone: '+966122345002',
      street_address: 'Prince Sultan Street',
      building_number: '2210',
      district: 'Al Zahra',
      city: 'Jeddah',
      country: 'Saudi Arabia',
      postal_code: '23522',
      tax_id: '311111111100003',
      payment_terms: 15,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      customer_no: 'CUST-003',
      name: 'Dammam Corporate Client',
      email: 'billing@dammam-corp.example',
      phone: '+966132345003',
      street_address: 'King Saud Street',
      building_number: '9090',
      district: 'Al Faisaliyah',
      city: 'Dammam',
      country: 'Saudi Arabia',
      postal_code: '32271',
      tax_id: '322222222200003',
      payment_terms: 45,
      is_active: true,
    },
  ], 'company_id,customer_no')

  const vendors = await upsertRows('vendors', [
    {
      company_id: COMPANY_ID,
      vendor_no: 'VEND-001',
      name: 'STC Supplier',
      email: 'suppliers@stc.example',
      phone: '+966114550001',
      address: 'Riyadh, Saudi Arabia',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      tax_id: '300000000000003',
      payment_terms: 30,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      vendor_no: 'VEND-002',
      name: 'Mobily Wholesale',
      email: 'wholesale@mobily.example',
      phone: '+966114550002',
      address: 'Jeddah, Saudi Arabia',
      city: 'Jeddah',
      country: 'Saudi Arabia',
      tax_id: '300000000000004',
      payment_terms: 30,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      vendor_no: 'VEND-003',
      name: 'Cisco Distributor',
      email: 'orders@cisco-distributor.example',
      phone: '+966114550003',
      address: 'Dammam, Saudi Arabia',
      city: 'Dammam',
      country: 'Saudi Arabia',
      tax_id: '300000000000005',
      payment_terms: 45,
      is_active: true,
    },
  ], 'company_id,vendor_no')

  const inventory = await upsertRows('inventory_items', [
    {
      company_id: COMPANY_ID,
      item_code: 'ITEM-ROUTER',
      name: 'Router',
      description: 'Business-grade edge router',
      category: 'Hardware',
      unit: 'PCS',
      cost_price: 650,
      sale_price: 950,
      quantity: 25,
      min_quantity: 5,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      item_code: 'ITEM-SWITCH',
      name: 'Network Switch',
      description: '24-port managed switch',
      category: 'Hardware',
      unit: 'PCS',
      cost_price: 1100,
      sale_price: 1650,
      quantity: 14,
      min_quantity: 3,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      item_code: 'ITEM-MANAGED-IT',
      name: 'Managed IT Service',
      description: 'Monthly managed IT support',
      category: 'Service',
      unit: 'MONTH',
      cost_price: 0,
      sale_price: 2500,
      quantity: 999,
      min_quantity: 0,
      is_active: true,
    },
    {
      company_id: COMPANY_ID,
      item_code: 'ITEM-INTERNET',
      name: 'Internet Package',
      description: 'Dedicated business internet package',
      category: 'Service',
      unit: 'MONTH',
      cost_price: 300,
      sale_price: 1200,
      quantity: 999,
      min_quantity: 0,
      is_active: true,
    },
  ], 'company_id,item_code')

  const customerByNo = new Map(customers.map((customer) => [customer.customer_no, customer]))
  const invoiceRows = [
    { no: 'INV-SEED-001', customerNo: 'CUST-001', type: 'STANDARD', subtotal: 3000, tax: 450, status: 'DRAFT' },
    { no: 'INV-SEED-002', customerNo: 'CUST-002', type: 'SIMPLIFIED', subtotal: 1200, tax: 180, status: 'DRAFT' },
    { no: 'INV-SEED-003', customerNo: 'CUST-003', type: 'STANDARD', subtotal: 4150, tax: 622.5, status: 'DRAFT' },
    { no: 'INV-SEED-004', customerNo: 'CUST-001', type: 'CREDIT_NOTE', subtotal: 500, tax: 75, status: 'DRAFT' },
    { no: 'INV-SEED-005', customerNo: 'CUST-003', type: 'DEBIT_NOTE', subtotal: 900, tax: 135, status: 'DRAFT' },
  ]

  const invoices = await upsertRows('invoices', invoiceRows.map((invoice, index) => {
    const total = invoice.subtotal + invoice.tax
    const invoiceUUID = randomUUID()
    return {
      company_id: COMPANY_ID,
      invoice_no: invoice.no,
      invoice_uuid: invoiceUUID,
      invoice_hash: invoiceHash(`${invoice.no}:${invoiceUUID}`),
      previous_invoice_hash: index === 0 ? null : invoiceHash(invoiceRows[index - 1].no),
      invoice_type: invoice.type,
      customer_id: customerByNo.get(invoice.customerNo)?.id,
      date: new Date(now.getTime() - index * 86400000).toISOString(),
      issue_time: '10:00:00',
      due_date: new Date(now.getTime() + (30 - index) * 86400000).toISOString(),
      currency: 'SAR',
      status: invoice.status,
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax,
      total,
      amount_paid: 0,
      balance: total,
      zatca_status: 'DRAFT',
      created_by_id: createdById,
      notes: 'Seeded demo invoice for manual ZATCA testing.',
    }
  }), 'company_id,invoice_no')

  const db = createAdminClient()
  const invoiceLines = invoices.flatMap((invoice) => ([
    {
      company_id: COMPANY_ID,
      invoice_id: invoice.id,
      description: invoice.invoice_type === 'SIMPLIFIED' ? 'Internet Package' : 'Managed IT Service',
      quantity: 1,
      unit_price: Number(invoice.subtotal),
      tax_rate: 15,
      amount: Number(invoice.subtotal),
    },
  ]))

  if (invoices.length > 0) {
    const { error: deleteLinesError } = await db
      .from('invoice_lines')
      .delete()
      .in('invoice_id', invoices.map((invoice) => invoice.id))
    if (deleteLinesError) throw deleteLinesError

    const { error: lineError } = await db.from('invoice_lines').insert(invoiceLines)
    if (lineError) throw lineError
  }

  return {
    status: 'seeded',
    customers: customers.length,
    inventory: inventory.length,
    invoices: invoices.length,
    vendors: vendors.length,
    message: `Seeded ${customers.length} customers, ${vendors.length} vendors, ${inventory.length} inventory items, and ${invoices.length} invoices.`,
  }
}
