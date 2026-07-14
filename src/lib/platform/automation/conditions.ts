import type { AutomationCondition } from '../types'

export function evaluateConditions(
  conditions: { operator?: 'AND' | 'OR'; rules?: AutomationCondition[] } | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions?.rules?.length) return true
  const operator = conditions.operator ?? 'AND'
  const results = conditions.rules.map((rule) => {
    const left = payload[rule.field]
    switch (rule.op) {
      case 'eq': return left === rule.value || String(left) === String(rule.value)
      case 'neq': return left !== rule.value
      case 'gt': return Number(left) > Number(rule.value)
      case 'gte': return Number(left) >= Number(rule.value)
      case 'lt': return Number(left) < Number(rule.value)
      case 'lte': return Number(left) <= Number(rule.value)
      case 'in': return Array.isArray(rule.value) && rule.value.map(String).includes(String(left))
      case 'contains': return String(left ?? '').toLowerCase().includes(String(rule.value).toLowerCase())
      default: return false
    }
  })
  return operator === 'OR' ? results.some(Boolean) : results.every(Boolean)
}
