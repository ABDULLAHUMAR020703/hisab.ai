import type { WorkflowConditionContext, WorkflowConditionGroup, WorkflowConditionRule } from './types'

function compareValues(left: unknown, op: WorkflowConditionRule['op'], right: unknown): boolean {
  switch (op) {
    case 'eq':
      return left === right || String(left) === String(right)
    case 'neq':
      return left !== right && String(left) !== String(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    case 'in':
      return Array.isArray(right) && right.map(String).includes(String(left))
    case 'contains':
      return String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase())
    default:
      return false
  }
}

function resolveField(ctx: WorkflowConditionContext, field: string): unknown {
  switch (field) {
    case 'amount':
      return ctx.amount ?? 0
    case 'department_id':
    case 'departmentId':
      return ctx.departmentId ?? null
    case 'entity_type':
    case 'entityType':
      return ctx.entityType ?? null
    case 'entity_subtype':
    case 'entitySubtype':
      return ctx.entitySubtype ?? null
    case 'submitted_by_id':
    case 'submittedById':
      return ctx.submittedById ?? null
    default:
      return ctx.metadata?.[field]
  }
}

export function evaluateWorkflowConditions(
  conditions: WorkflowConditionGroup | null | undefined,
  ctx: WorkflowConditionContext,
): boolean {
  if (!conditions || !conditions.rules || conditions.rules.length === 0) return true

  const operator = conditions.operator ?? 'AND'
  const results = conditions.rules.map((rule) =>
    compareValues(resolveField(ctx, rule.field), rule.op, rule.value),
  )

  return operator === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

export function stepAppliesToAmount(
  amount: number,
  amountMin: number | null | undefined,
  amountMax: number | null | undefined,
): boolean {
  if (amountMin != null && amount < amountMin) return false
  if (amountMax != null && amount > amountMax) return false
  return true
}

export function isStepComplete(
  approvalMode: 'SEQUENTIAL' | 'PARALLEL',
  parallelPolicy: 'ALL' | 'ANY',
  tasks: Array<{ status: string }>,
): boolean {
  const pending = tasks.filter((t) => t.status === 'PENDING')
  const approved = tasks.filter((t) => t.status === 'APPROVED')

  if (approvalMode === 'SEQUENTIAL') {
    return approved.length >= 1 && pending.length === 0
  }

  if (parallelPolicy === 'ANY') {
    return approved.length >= 1
  }

  return tasks.length > 0 && approved.length === tasks.length
}
