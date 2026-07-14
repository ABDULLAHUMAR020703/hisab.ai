export type DocumentStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED'
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH'
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DEAD' | 'CANCELLED'
export type JobPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

export interface AutomationCondition {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: unknown
}

export interface AutomationAction {
  type: string
  config?: Record<string, unknown>
}

export interface PlatformEvent {
  eventType: string
  companyId: string
  entityType?: string
  entityId?: string
  payload?: Record<string, unknown>
  userId?: string | null
}

export const JOB_TYPES = [
  'REPORT_SCHEDULE',
  'RECURRING_INVOICE',
  'RECURRING_BILL',
  'PAYROLL_RUN',
  'EXCHANGE_RATE_SYNC',
  'EMAIL_SEND',
  'WORKFLOW_REMINDER',
  'INVENTORY_RECALC',
  'WEBHOOK_RETRY',
  'AUTOMATION_RUN',
] as const

export type JobType = typeof JOB_TYPES[number]

export const SEARCH_ENTITY_TYPES = [
  'customers', 'vendors', 'invoices', 'bills', 'products',
  'journal_entries', 'documents', 'employees', 'accounts',
] as const
