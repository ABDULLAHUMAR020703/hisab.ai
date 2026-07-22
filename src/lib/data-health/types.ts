export type HealthSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational'

export interface HealthFinding {
  checkId: string
  severity: HealthSeverity
  entityType: string
  entityId?: string
  title: string
  detail: string
  recommendation: string
  confidence?: number
}

export interface HealthCategoryScore {
  category: string
  score: number
  findingCounts: Partial<Record<HealthSeverity, number>>
}

export interface HealthReport {
  scanId: string
  engineVersion: string
  overallScore: number
  categoryScores: HealthCategoryScore[]
  findings: HealthFinding[]
  summary: Record<HealthSeverity, number>
  checksExecuted: string[]
  scannedAt: string
}

export interface HealthCheck {
  id: string
  category: string
  severity: HealthSeverity
  description: string
  moduleKey?: string
  versionAdded: string
  autoFixCapable: false
  detect: (ctx: HealthScanContext) => Promise<HealthFinding[]> | HealthFinding[]
}

export interface HealthScanContext {
  companyId: string
  applicableModules: string[]
  db: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>
}
