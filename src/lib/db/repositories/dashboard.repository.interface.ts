import type { DashboardPayload } from '../entities'

export interface DashboardRepository {
  getStats(): Promise<DashboardPayload>
}
