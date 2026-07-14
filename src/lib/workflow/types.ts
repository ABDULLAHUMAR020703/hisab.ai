export type WorkflowEntityType =
  | 'INVOICE'
  | 'BILL'
  | 'EXPENSE'
  | 'EXPENSE_CLAIM'
  | 'PAYROLL'
  | 'JOURNAL_ENTRY'
  | 'PURCHASE_ORDER'
  | 'ESTIMATE'
  | 'SALES_ORDER'
  | 'DOCUMENT'
  | 'VENDOR_CREDIT'

export const WORKFLOW_ENTITY_TYPES: WorkflowEntityType[] = [
  'INVOICE',
  'BILL',
  'EXPENSE',
  'EXPENSE_CLAIM',
  'PAYROLL',
  'JOURNAL_ENTRY',
  'PURCHASE_ORDER',
  'ESTIMATE',
  'SALES_ORDER',
  'DOCUMENT',
  'VENDOR_CREDIT',
]

export type WorkflowApprovalMode = 'SEQUENTIAL' | 'PARALLEL'
export type WorkflowParallelPolicy = 'ALL' | 'ANY'
export type WorkflowApproverType = 'USER' | 'ROLE' | 'DEPARTMENT' | 'MANAGER'
export type WorkflowInstanceStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
export type WorkflowTaskStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DELEGATED'
  | 'ESCALATED'
  | 'SKIPPED'
  | 'CANCELLED'

export interface WorkflowConditionContext {
  amount?: number
  departmentId?: string | null
  entityType?: string
  entitySubtype?: string | null
  submittedById?: string | null
  metadata?: Record<string, unknown>
}

export interface WorkflowConditionGroup {
  operator?: 'AND' | 'OR'
  rules?: WorkflowConditionRule[]
}

export interface WorkflowConditionRule {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: unknown
}

export interface WorkflowTemplateStep {
  id: string
  stepOrder: number
  name: string
  approvalMode: WorkflowApprovalMode
  parallelPolicy: WorkflowParallelPolicy
  amountMin: number | null
  amountMax: number | null
  conditions: WorkflowConditionGroup
  escalationHours: number | null
  escalationUserId: string | null
  reminderHours: number | null
}

export interface WorkflowSubmitInput {
  entityType: WorkflowEntityType
  entityId: string
  entityLabel?: string
  amount?: number
  departmentId?: string | null
  submittedById?: string | null
  companyId?: string
  metadata?: Record<string, unknown>
  templateId?: string
}
