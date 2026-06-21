import type { CompanySettingsRecord, CompanySettingsUpdateInput } from '../types'

/** Contract for company settings data access (Prisma + Supabase parity). */
export interface SettingsRepository {
  findFirst(): Promise<CompanySettingsRecord | null>
  create(input: CompanySettingsUpdateInput & { companyName: string }): Promise<CompanySettingsRecord>
  update(companyId: string, input: CompanySettingsUpdateInput): Promise<CompanySettingsRecord>
  upsert(input: CompanySettingsUpdateInput & { companyName?: string }): Promise<CompanySettingsRecord>
}
