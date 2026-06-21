import 'server-only'
import { mapChartOfAccountRow } from '../entity-mappers'
import type { ChartOfAccountRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import type { AccountListOptions, AccountRepository } from './account.repository.interface'

export const supabaseAccountRepository: AccountRepository = {
  async findMany(options: AccountListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()
    const type = options.type?.trim()

    let query = db
      .from('chart_of_accounts')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('account_no', { ascending: true })

    if (type) query = query.eq('account_type', type)
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,account_no.ilike.%${search}%,full_name.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapChartOfAccountRow)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'chart_of_accounts', id, companyId)
    return row ? mapChartOfAccountRow(row) : null
  },
}
