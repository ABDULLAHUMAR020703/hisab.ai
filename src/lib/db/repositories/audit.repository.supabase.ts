import 'server-only'
import { mapZatcaAuditLogRow } from '../entity-mappers'
import { resolveCompanyId, supabaseDb } from '../repository-utils'
import type { AuditRepository } from './audit.repository.interface'

export const supabaseAuditRepository: AuditRepository = {
  async findRecent(limit = 50) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const { data, error } = await db
      .from('zatca_audit_logs')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return (data ?? []).map(mapZatcaAuditLogRow)
  },
}
