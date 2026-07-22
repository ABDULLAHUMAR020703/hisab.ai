/** Wizard + detection engine version stamps (persisted on every session). */
export const WIZARD_VERSION = '1.0.0'
export const DETECTION_ENGINE_VERSION = 'v1.0'
export const DATA_HEALTH_ENGINE_VERSION = 'v1.0'

export const READY_SCORE_THRESHOLD = 90
export const FINDING_SAMPLE_LIMIT = 50

export const CONFIRM_PHRASE = 'GO LIVE'

export const DEFAULT_READINESS_MODULES: Record<string, boolean> = {
  core_company: true,
  accounting: true,
  opening_balances: true,
  document_numbering: true,
  sales: true,
  purchasing: true,
  inventory: false,
  cost_centers: true,
  payroll: false,
  manufacturing: false,
  fixed_assets: false,
  zatca: true,
}
