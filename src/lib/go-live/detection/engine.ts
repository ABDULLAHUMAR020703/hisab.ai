import type { ConfidenceFactor, Finding, RiskLevel } from '../types'

export type DetectionEntityType =
  | 'invoice'
  | 'customer'
  | 'vendor'
  | 'product'
  | 'cost_center'

export interface DetectionContext {
  entityType: DetectionEntityType
  entity: Record<string, unknown>
  related?: {
    invoiceCount?: number
    paymentCount?: number
    hasProtectedInvoiceRefs?: boolean
  }
}

export interface DetectionRule {
  id: string
  entityType: DetectionEntityType | '*'
  weight: number
  versionAdded: string
  deprecatedIn?: string
  applies: (ctx: DetectionContext) => boolean
  reason: (ctx: DetectionContext) => string
}

const TEST_NAME_RE = /\b(test|demo|sample|walk[\s-]?in|zatca\s+compliance)\b/i
const TEST_PREFIX_RE = /^(TEST|DEMO|SAMPLE)[-_]/i

export const DETECTION_RULES: DetectionRule[] = [
  {
    id: 'invoice.draft',
    entityType: 'invoice',
    weight: 0.25,
    versionAdded: 'v1.0',
    applies: (ctx) => String(ctx.entity.status ?? '').toUpperCase() === 'DRAFT',
    reason: () => 'Draft invoice',
  },
  {
    id: 'invoice.never_submitted',
    entityType: 'invoice',
    weight: 0.2,
    versionAdded: 'v1.0',
    applies: (ctx) => {
      const z = String(ctx.entity.zatcaStatus ?? '').toUpperCase()
      return !z || z === 'DRAFT' || z === 'PENDING' || z === 'NULL'
    },
    reason: () => 'Never submitted to ZATCA',
  },
  {
    id: 'invoice.no_payments',
    entityType: 'invoice',
    weight: 0.15,
    versionAdded: 'v1.0',
    applies: (ctx) => (ctx.related?.paymentCount ?? 0) === 0,
    reason: () => 'No payments',
  },
  {
    id: 'invoice.test_prefix',
    entityType: 'invoice',
    weight: 0.25,
    versionAdded: 'v1.0',
    applies: (ctx) => TEST_PREFIX_RE.test(String(ctx.entity.invoiceNo ?? '')),
    reason: () => 'Matches known demo number prefix',
  },
  {
    id: 'invoice.failed',
    entityType: 'invoice',
    weight: 0.1,
    versionAdded: 'v1.0',
    applies: (ctx) => {
      const z = String(ctx.entity.zatcaStatus ?? '').toUpperCase()
      return z === 'FAILED' || z === 'REJECTED'
    },
    reason: () => 'Submission failed or rejected',
  },
  {
    id: 'customer.test_name',
    entityType: 'customer',
    weight: 0.35,
    versionAdded: 'v1.0',
    applies: (ctx) => TEST_NAME_RE.test(String(ctx.entity.name ?? '')),
    reason: () => 'Matches known demo / test name pattern',
  },
  {
    id: 'customer.unused',
    entityType: 'customer',
    weight: 0.25,
    versionAdded: 'v1.0',
    applies: (ctx) => (ctx.related?.invoiceCount ?? 0) === 0,
    reason: () => 'Customer never used on an invoice',
  },
  {
    id: 'vendor.test_name',
    entityType: 'vendor',
    weight: 0.35,
    versionAdded: 'v1.0',
    applies: (ctx) => TEST_NAME_RE.test(String(ctx.entity.name ?? '')),
    reason: () => 'Matches known demo / test name pattern',
  },
  {
    id: 'vendor.unused',
    entityType: 'vendor',
    weight: 0.25,
    versionAdded: 'v1.0',
    applies: (ctx) => (ctx.related?.invoiceCount ?? 0) === 0,
    reason: () => 'Vendor never used on a bill',
  },
  {
    id: 'product.test_name',
    entityType: 'product',
    weight: 0.3,
    versionAdded: 'v1.0',
    applies: (ctx) => TEST_NAME_RE.test(String(ctx.entity.name ?? '')),
    reason: () => 'Matches known demo / test name pattern',
  },
  {
    id: 'cost_center.test_name',
    entityType: 'cost_center',
    weight: 0.3,
    versionAdded: 'v1.0',
    applies: (ctx) => TEST_NAME_RE.test(String(ctx.entity.name ?? '')),
    reason: () => 'Matches known demo / test name pattern',
  },
]

export function listActiveRules(): DetectionRule[] {
  return DETECTION_RULES.filter((r) => !r.deprecatedIn)
}

export function runRules(ctx: DetectionContext): {
  confidence: number
  factors: ConfidenceFactor[]
  matchedRuleIds: string[]
} {
  const matched = listActiveRules().filter(
    (r) => (r.entityType === '*' || r.entityType === ctx.entityType) && r.applies(ctx),
  )
  const factors = matched.map((r) => ({
    ruleId: r.id,
    reason: r.reason(ctx),
    weight: r.weight,
  }))
  const confidence = Math.min(
    1,
    factors.reduce((s, f) => s + f.weight, 0),
  )
  return {
    confidence,
    factors,
    matchedRuleIds: matched.map((r) => r.id),
  }
}

const PROTECTED_ZATCA = new Set(['SUBMITTED', 'CLEARED', 'REPORTED'])

export function classifyInvoiceRisk(entity: Record<string, unknown>): {
  risk: RiskLevel
  protectedReason?: string
} {
  const zatca = String(entity.zatcaStatus ?? '').toUpperCase()
  const uuid = entity.invoiceUUID ?? entity.invoice_uuid
  const hash = entity.invoiceHash ?? entity.invoice_hash
  if (PROTECTED_ZATCA.has(zatca) || uuid || hash) {
    return {
      risk: 'PROTECTED',
      protectedReason:
        'Already submitted to ZATCA Production (or has UUID/hash). Cannot be removed through the wizard.',
    }
  }
  if (zatca === 'FAILED' || zatca === 'REJECTED') return { risk: 'REVIEW' }
  if (String(entity.status ?? '').toUpperCase() === 'DRAFT') return { risk: 'SAFE' }
  return { risk: 'REVIEW' }
}

export function toFinding(input: {
  entityType: string
  entityId: string
  label: string
  risk: RiskLevel
  confidence: number
  factors: ConfidenceFactor[]
  matchedRuleIds: string[]
  dependencies?: Finding['dependencies']
  protectedReason?: string
}): Finding {
  const highConfidence = input.confidence >= 0.7

  let suggestedAction: Finding['suggestedAction'] = 'none'
  if (input.risk !== 'PROTECTED') {
    suggestedAction = input.entityType === 'invoice' ? 'soft_delete' : 'archive'
  }

  const recommendation =
    input.risk === 'PROTECTED'
      ? input.protectedReason ?? 'Protected — do not modify.'
      : input.entityType === 'invoice'
        ? highConfidence
          ? 'Safe to soft-delete if confirmed.'
          : 'Review before soft-delete.'
        : highConfidence
          ? 'Safe to archive if confirmed.'
          : 'Review before archive.'

  return {
    id: `${input.entityType}:${input.entityId}`,
    entityType: input.entityType,
    entityId: input.entityId,
    label: input.label,
    risk: input.risk,
    severityClass: 'recommended',
    confidence: Math.round(input.confidence * 100),
    confidenceFactors: input.factors,
    matchedRuleIds: input.matchedRuleIds,
    recommendation,
    dependencies: input.dependencies,
    canAct: input.risk !== 'PROTECTED',
    suggestedAction,
  }
}

/** Simplify canAct: protected never; others yes unless master data has protected invoice refs */
export function finalizeFindingCanAct(finding: Finding, hasProtectedRefs: boolean): Finding {
  if (finding.risk === 'PROTECTED') {
    return { ...finding, canAct: false, suggestedAction: 'none' }
  }
  if (finding.entityType !== 'invoice' && hasProtectedRefs) {
    return {
      ...finding,
      canAct: false,
      suggestedAction: 'none',
      recommendation: 'Cannot safely archive — referenced by protected invoices.',
    }
  }
  return {
    ...finding,
    canAct: true,
  }
}
