export type GoLiveSessionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'ANALYZED'
  | 'PREVIEWED'
  | 'EXECUTED'
  | 'EXECUTED_WITH_WARNINGS'
  | 'FAILED'
  | 'CANCELLED'

export type RiskLevel = 'BLOCKED' | 'PROTECTED' | 'REVIEW' | 'SAFE'
export type SeverityClass = 'required' | 'recommended'
export type OpeningBalanceMode = 'UNSET' | 'EXISTING_BUSINESS' | 'NEW_BUSINESS_ZERO'
export type ReadinessVerdict = 'Blocked' | 'Needs Attention' | 'Ready'

export type ChecklistItemStatus = 'complete' | 'incomplete' | 'blocked'

export interface ChecklistItem {
  id: string
  label: string
  status: ChecklistItemStatus
  required: boolean
  moduleKey: string
  fixHref?: string
  message?: string
}

export interface ConfidenceFactor {
  ruleId: string
  reason: string
  weight: number
}

export interface Finding {
  id: string
  entityType: string
  entityId: string
  label: string
  risk: RiskLevel
  severityClass: SeverityClass
  confidence: number
  confidenceFactors: ConfidenceFactor[]
  matchedRuleIds: string[]
  recommendation: string
  dependencies?: { entityType: string; count: number; detail?: string }[]
  canAct: boolean
  suggestedAction?: 'soft_delete' | 'archive' | 'none'
}

export interface CheckResult {
  id: string
  moduleKey: string
  severityClass: SeverityClass
  passed: boolean
  blocked: boolean
  label: string
  message: string
  fixHref?: string
  weight: number
}

export interface CategoryScore {
  key: string
  label: string
  weight: number
  score: number
  applicable: boolean
}

export interface ReadinessAnalysis {
  score: number
  verdict: ReadinessVerdict
  checklist: ChecklistItem[]
  checks: CheckResult[]
  blocked: CheckResult[]
  categoryScores: CategoryScore[]
  findings: Finding[]
  protectedSummary: Record<string, number>
  moduleCounts: Record<string, number>
  zatca: Record<string, unknown>
  numbering: Record<string, unknown>
  rulesExecuted: string[]
  openingBalanceMode: OpeningBalanceMode
  applicableModules: string[]
  wizardVersion: string
  detectionEngineVersion: string
  analyzedAt: string
}

export interface GoLiveSelection {
  softDeleteInvoiceIds: string[]
  archiveCustomerIds: string[]
  archiveVendorIds: string[]
  archiveProductIds: string[]
  archiveCostCenterIds: string[]
  numbering?: {
    documentType: string
    nextNumber: number
    prefix?: string
    padding?: number
    suffix?: string
  } | null
  acknowledgeDashboardLive: boolean
}

export interface PreviewPlan {
  archive: { entityType: string; ids: string[]; labels: string[] }[]
  softDelete: { entityType: string; ids: string[]; labels: string[] }[]
  keep: { label: string; count: number }[]
  untouched: string[]
  numbering: Record<string, unknown> | null
  blockedRemaining: CheckResult[]
  zatcaCredentialsUnchanged: true
  canExecute: boolean
  blockers: string[]
}

export interface ProductionLiveState {
  productionLiveAt: string | null
  productionLiveBy: string | null
  productionLiveWizardVersion: string | null
  productionLiveDetectionEngineVersion: string | null
}
