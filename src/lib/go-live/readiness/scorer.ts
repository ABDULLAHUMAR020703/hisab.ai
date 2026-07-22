import { READY_SCORE_THRESHOLD } from '../constants'
import type {
  CategoryScore,
  CheckResult,
  ChecklistItem,
  ReadinessVerdict,
} from '../types'

export function buildChecklist(checks: CheckResult[]): ChecklistItem[] {
  return checks.map((c) => ({
    id: c.id,
    label: c.label,
    status: c.blocked ? 'blocked' : c.passed ? 'complete' : 'incomplete',
    required: c.severityClass === 'required',
    moduleKey: c.moduleKey,
    fixHref: c.fixHref,
    message: c.message,
  }))
}

export function computeReadinessScore(checks: CheckResult[]): {
  score: number
  categoryScores: CategoryScore[]
  verdict: ReadinessVerdict
  blocked: CheckResult[]
} {
  const applicable = checks.filter((c) => c.weight > 0)
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0) || 1
  const earned = applicable.reduce((s, c) => s + (c.passed ? c.weight : 0), 0)
  const score = Math.round((earned / totalWeight) * 100)

  const byModule = new Map<string, CheckResult[]>()
  for (const c of applicable) {
    const list = byModule.get(c.moduleKey) ?? []
    list.push(c)
    byModule.set(c.moduleKey, list)
  }

  const categoryScores: CategoryScore[] = [...byModule.entries()].map(([key, list]) => {
    const w = list.reduce((s, c) => s + c.weight, 0) || 1
    const e = list.reduce((s, c) => s + (c.passed ? c.weight : 0), 0)
    return {
      key,
      label: key.replace(/_/g, ' '),
      weight: w,
      score: Math.round((e / w) * 100),
      applicable: true,
    }
  })

  const blocked = checks.filter((c) => c.blocked)
  let verdict: ReadinessVerdict = 'Needs Attention'
  if (blocked.length > 0) verdict = 'Blocked'
  else if (score >= READY_SCORE_THRESHOLD) verdict = 'Ready'

  return { score, categoryScores, verdict, blocked }
}
