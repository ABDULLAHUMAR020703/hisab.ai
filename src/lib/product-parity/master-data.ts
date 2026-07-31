import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { requiredText } from './validation'

const TABLES = {
  'customer-types': { table: 'customer_types', code: false },
  'payment-methods': { table: 'payment_methods', code: true },
  'tax-agencies': { table: 'tax_agencies', code: true },
} as const

export type ProductMasterKey = keyof typeof TABLES

async function assertCompanyAccount(companyId: string, id: unknown, field: string, required = false) {
  if (!id) {
    if (required) throw new Error(`${field} is required.`)
    return null
  }
  const { data, error } = await createAdminClient().from('chart_of_accounts').select('id').eq('company_id', companyId).eq('id', String(id)).eq('is_active', true).is('deleted_at', null).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`${field} was not found in this company.`)
  return String(data.id)
}

export async function listProductMaster(companyId: string, key: ProductMasterKey) {
  const config = TABLES[key]
  const { data, error } = await createAdminClient().from(config.table).select('*').eq('company_id', companyId).is('deleted_at', null).order('name')
  if (error) throw error
  return data ?? []
}

export async function createProductMaster(companyId: string, key: ProductMasterKey, input: Record<string, unknown>) {
  const config = TABLES[key]
  const name = requiredText(input.name, 'Name', 120)
  const row: Record<string, unknown> = { company_id: companyId, name, is_active: input.isActive ?? true }
  if (key !== 'tax-agencies') row.description = input.description ?? null
  if (config.code) row.code = requiredText(input.code, 'Code', 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
  if (key === 'payment-methods') {
    const type = String(input.methodType ?? 'OTHER').toUpperCase()
    if (!['CASH','BANK_TRANSFER','CARD','CHEQUE','OTHER'].includes(type)) throw new Error('Invalid payment method type.')
    Object.assign(row, { method_type: type, clearing_account_id: await assertCompanyAccount(companyId, input.clearingAccountId, 'Clearing account') })
  }
  if (key === 'tax-agencies') {
    const paymentTermsDays = Number(input.paymentTermsDays ?? 0)
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) throw new Error('Payment terms days must be a non-negative whole number.')
    Object.assign(row, { registration_number: input.registrationNumber ?? null, liability_account_id: await assertCompanyAccount(companyId, input.liabilityAccountId, 'Liability account', true), receivable_account_id: await assertCompanyAccount(companyId, input.receivableAccountId, 'Receivable account'), payment_terms_days: paymentTermsDays })
  }
  const { data, error } = await createAdminClient().from(config.table).insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateProductMaster(companyId: string, key: ProductMasterKey, id: string, input: Record<string, unknown>) {
  const config = TABLES[key]
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) patch.name = requiredText(input.name, 'Name', 120)
  if (input.description !== undefined) patch.description = input.description
  if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive)
  if (config.code && input.code !== undefined) patch.code = requiredText(input.code, 'Code', 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
  if (key === 'payment-methods') {
    if (input.methodType !== undefined) {
      const methodType = String(input.methodType).toUpperCase()
      if (!['CASH','BANK_TRANSFER','CARD','CHEQUE','OTHER'].includes(methodType)) throw new Error('Invalid payment method type.')
      patch.method_type = methodType
    }
    if (input.clearingAccountId !== undefined) patch.clearing_account_id = await assertCompanyAccount(companyId, input.clearingAccountId, 'Clearing account')
  }
  if (key === 'tax-agencies') {
    if (input.registrationNumber !== undefined) patch.registration_number = input.registrationNumber
    if (input.liabilityAccountId !== undefined) patch.liability_account_id = await assertCompanyAccount(companyId, input.liabilityAccountId, 'Liability account', true)
    if (input.receivableAccountId !== undefined) patch.receivable_account_id = await assertCompanyAccount(companyId, input.receivableAccountId, 'Receivable account')
    if (input.paymentTermsDays !== undefined) {
      const days = Number(input.paymentTermsDays)
      if (!Number.isInteger(days) || days < 0) throw new Error('Payment terms days must be a non-negative whole number.')
      patch.payment_terms_days = days
    }
  }
  const { data, error } = await createAdminClient().from(config.table).update(patch).eq('company_id', companyId).eq('id', id).is('deleted_at', null).select('*').single()
  if (error) throw error
  return data
}

export async function archiveProductMaster(companyId: string, key: ProductMasterKey, id: string) {
  const { error } = await createAdminClient().from(TABLES[key].table).update({ is_active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', id)
  if (error) throw error
}
