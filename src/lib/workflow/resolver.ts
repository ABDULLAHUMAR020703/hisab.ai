import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { evaluateWorkflowConditions, stepAppliesToAmount } from './conditions'
import type { WorkflowConditionContext, WorkflowEntityType } from './types'

export async function resolveWorkflowTemplate(input: {
  entityType: WorkflowEntityType
  companyId?: string
  context: WorkflowConditionContext
  templateId?: string
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  if (input.templateId) {
    const { data } = await client
      .from('workflow_templates')
      .select('*')
      .eq('id', input.templateId)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    return data
  }

  const { data: bindings, error } = await client
    .from('workflow_bindings')
    .select('*, template:workflow_templates(*)')
    .eq('company_id', companyId)
    .eq('entity_type', input.entityType)
    .eq('is_active', true)
    .order('priority', { ascending: true })

  if (error) throw error

  for (const binding of bindings ?? []) {
    const template = binding.template as Record<string, unknown> | null
    if (!template || template.is_active === false || template.deleted_at) continue
    const conditions = (binding.conditions ?? {}) as Record<string, unknown>
    if (evaluateWorkflowConditions(conditions as never, input.context)) {
      return template
    }
  }

  return null
}

export async function loadTemplateSteps(templateId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: steps, error } = await client
    .from('workflow_template_steps')
    .select('*, approvers:workflow_template_step_approvers(*)')
    .eq('template_id', templateId)
    .eq('company_id', cid)
    .eq('is_active', true)
    .order('step_order', { ascending: true })

  if (error) throw error
  return steps ?? []
}

export async function filterApplicableSteps(
  steps: Array<Record<string, unknown>>,
  amount: number,
  context: WorkflowConditionContext,
) {
  return steps.filter((step) => {
    const amountMin = step.amount_min != null ? Number(step.amount_min) : null
    const amountMax = step.amount_max != null ? Number(step.amount_max) : null
    if (!stepAppliesToAmount(amount, amountMin, amountMax)) return false
    return evaluateWorkflowConditions((step.conditions ?? {}) as never, context)
  })
}
