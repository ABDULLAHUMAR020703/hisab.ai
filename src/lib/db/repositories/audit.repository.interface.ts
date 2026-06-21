import type { ZatcaAuditLogRecord } from '../entities'

export interface AuditRepository {
  findRecent(limit?: number): Promise<ZatcaAuditLogRecord[]>
}
