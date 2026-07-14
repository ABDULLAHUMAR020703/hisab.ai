import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { evaluateWorkflowConditions, isStepComplete, stepAppliesToAmount } from './conditions'
import { resolveActiveDelegate, resolveStepAssignees } from './assignees'
import { filterApplicableSteps, loadTemplateSteps, resolveWorkflowTemplate } from './resolver'
import { createWorkflowNotification } from './notifications'
import type { WorkflowConditionContext, WorkflowSubmitInput } from './types'

export class WorkflowError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'WorkflowError'
  }
}

async function writeHistory(input: {
  companyId: string
  instanceId: string
  taskId?: string | null
  action: string
  actorUserId?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  comments?: string | null
  metadata?: Record<string, unknown>
}) {
  const client = createAdminClient()
  await client.from('workflow_history').insert({
    company_id: input.companyId,
    instance_id: input.instanceId,
    task_id: input.taskId ?? null,
    action: input.action,
    actor_user_id: input.actorUserId ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    comments: input.comments ?? null,
    metadata: input.metadata ?? {},
  })
}

async function activateStep(
  companyId: string,
  instance: Record<string, unknown>,
  step: Record<string, unknown>,
) {
  const client = createAdminClient()
  const assignees = await resolveStepAssignees(companyId, step, {
    submitterId: instance.submitted_by_id as string | null,
  })

  if (assignees.length === 0) {
    throw new WorkflowError('No approvers configured for workflow step', 'NO_APPROVERS')
  }

  const approvalMode = String(step.approval_mode ?? 'SEQUENTIAL')
  const targets = approvalMode === 'SEQUENTIAL' ? [assignees[0]] : assignees
  const escalationHours = step.escalation_hours != null ? Number(step.escalation_hours) : null
  const dueAt = escalationHours
    ? new Date(Date.now() + escalationHours * 60 * 60 * 1000).toISOString()
    : null

  const tasks = []
  for (const userId of targets) {
    const delegateId = await resolveActiveDelegate(companyId, userId)
    const assignee = delegateId ?? userId

    const { data: task, error } = await client
      .from('workflow_tasks')
      .insert({
        company_id: companyId,
        instance_id: instance.id,
        step_id: step.id,
        step_order: step.step_order,
        assignee_user_id: assignee,
        delegated_from_user_id: delegateId ? userId : null,
        status: 'PENDING',
        due_at: dueAt,
      })
      .select('*')
      .single()

    if (error) throw error
    tasks.push(task)

    await createWorkflowNotification({
      companyId,
      userId: assignee,
      instanceId: String(instance.id),
      taskId: String(task.id),
      type: 'ASSIGNMENT',
      title: `Approval required: ${instance.entity_label ?? instance.entity_type}`,
      body: `Step "${step.name}" is awaiting your approval.`,
    })
  }

  await client
    .from('workflow_instances')
    .update({ status: 'IN_PROGRESS', current_step_order: step.step_order })
    .eq('id', instance.id)

  return tasks
}

export async function submitWorkflow(input: WorkflowSubmitInput) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const amount = Number(input.amount ?? 0)
  const context: WorkflowConditionContext = {
    amount,
    departmentId: input.departmentId,
    entityType: input.entityType,
    submittedById: input.submittedById,
    metadata: input.metadata,
  }

  const template = await resolveWorkflowTemplate({
    entityType: input.entityType,
    companyId,
    context,
    templateId: input.templateId,
  })

  if (!template) return null

  const { data: existing } = await client
    .from('workflow_instances')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .maybeSingle()

  if (existing && !['REJECTED', 'CANCELLED'].includes(String(existing.status))) {
    return existing
  }

  const allSteps = await loadTemplateSteps(String(template.id), companyId)
  const steps = await filterApplicableSteps(allSteps, amount, context)
  if (steps.length === 0) return null

  const { data: instance, error } = await client
    .from('workflow_instances')
    .insert({
      company_id: companyId,
      template_id: template.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_label: input.entityLabel ?? null,
      status: 'PENDING',
      current_step_order: steps[0].step_order as number,
      document_amount: amount,
      department_id: input.departmentId ?? null,
      submitted_by_id: input.submittedById ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()

  if (error) throw error

  await writeHistory({
    companyId,
    instanceId: String(instance.id),
    action: 'SUBMITTED',
    actorUserId: input.submittedById,
    toStatus: 'PENDING',
  })

  await activateStep(companyId, instance, steps[0])
  return instance
}

async function advanceWorkflow(companyId: string, instanceId: string) {
  const client = createAdminClient()
  const { data: instance } = await client
    .from('workflow_instances')
    .select('*')
    .eq('id', instanceId)
    .single()

  if (!instance) return

  const amount = Number(instance.document_amount ?? 0)
  const context: WorkflowConditionContext = {
    amount,
    departmentId: instance.department_id as string | null,
    entityType: instance.entity_type as string,
    submittedById: instance.submitted_by_id as string | null,
    metadata: (instance.metadata ?? {}) as Record<string, unknown>,
  }

  const allSteps = await loadTemplateSteps(String(instance.template_id), companyId)
  const steps = await filterApplicableSteps(allSteps, amount, context)
  const currentOrder = Number(instance.current_step_order)
  const nextStep = steps.find((s) => Number(s.step_order) > currentOrder)

  if (!nextStep) {
    await client
      .from('workflow_instances')
      .update({ status: 'APPROVED', completed_at: new Date().toISOString() })
      .eq('id', instanceId)

    await writeHistory({
      companyId,
      instanceId,
      action: 'COMPLETED',
      toStatus: 'APPROVED',
    })

    const { onWorkflowApproved } = await import('./integration')
    await onWorkflowApproved(instance)

    if (instance.submitted_by_id) {
      await createWorkflowNotification({
        companyId,
        userId: String(instance.submitted_by_id),
        instanceId,
        type: 'COMPLETED',
        title: 'Workflow approved',
        body: `${instance.entity_label ?? instance.entity_type} has been fully approved.`,
      })
    }
    return
  }

  await client
    .from('workflow_instances')
    .update({ current_step_order: nextStep.step_order })
    .eq('id', instanceId)

  await activateStep(companyId, instance, nextStep)
}

export async function approveWorkflowTask(
  taskId: string,
  options?: { userId?: string; comments?: string; companyId?: string },
) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: task, error } = await client
    .from('workflow_tasks')
    .select('*, instance:workflow_instances(*), step:workflow_template_steps(*)')
    .eq('id', taskId)
    .eq('company_id', companyId)
    .single()

  if (error || !task) throw new WorkflowError('Task not found', 'NOT_FOUND')
  if (task.status !== 'PENDING') throw new WorkflowError('Task is not pending', 'INVALID_STATUS')
  if (options?.userId && String(task.assignee_user_id) !== options.userId) {
    throw new WorkflowError('Not assigned to this user', 'FORBIDDEN')
  }

  await client
    .from('workflow_tasks')
    .update({
      status: 'APPROVED',
      acted_at: new Date().toISOString(),
      comments: options?.comments ?? null,
    })
    .eq('id', taskId)

  const instance = task.instance as Record<string, unknown>
  const step = task.step as Record<string, unknown>

  await writeHistory({
    companyId,
    instanceId: String(instance.id),
    taskId,
    action: 'APPROVED',
    actorUserId: options?.userId,
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
    comments: options?.comments,
  })

  const { data: stepTasks } = await client
    .from('workflow_tasks')
    .select('status')
    .eq('instance_id', instance.id)
    .eq('step_id', step.id)

  const complete = isStepComplete(
    String(step.approval_mode ?? 'SEQUENTIAL') as 'SEQUENTIAL' | 'PARALLEL',
    String(step.parallel_policy ?? 'ALL') as 'ALL' | 'ANY',
    stepTasks ?? [],
  )

  if (complete) {
    await client
      .from('workflow_tasks')
      .update({ status: 'CANCELLED' })
      .eq('instance_id', instance.id)
      .eq('step_id', step.id)
      .eq('status', 'PENDING')

    await advanceWorkflow(companyId, String(instance.id))
  }

  return task
}

export async function rejectWorkflowTask(
  taskId: string,
  options?: { userId?: string; comments?: string; companyId?: string },
) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: task, error } = await client
    .from('workflow_tasks')
    .select('*, instance:workflow_instances(*)')
    .eq('id', taskId)
    .eq('company_id', companyId)
    .single()

  if (error || !task) throw new WorkflowError('Task not found', 'NOT_FOUND')

  await client.from('workflow_tasks').update({
    status: 'REJECTED',
    acted_at: new Date().toISOString(),
    comments: options?.comments ?? null,
  }).eq('id', taskId)

  const instance = task.instance as Record<string, unknown>
  await client
    .from('workflow_instances')
    .update({ status: 'REJECTED', completed_at: new Date().toISOString() })
    .eq('id', instance.id)

  await client
    .from('workflow_tasks')
    .update({ status: 'CANCELLED' })
    .eq('instance_id', instance.id)
    .eq('status', 'PENDING')

  await writeHistory({
    companyId,
    instanceId: String(instance.id),
    taskId,
    action: 'REJECTED',
    actorUserId: options?.userId,
    toStatus: 'REJECTED',
    comments: options?.comments,
  })

  if (instance.submitted_by_id) {
    await createWorkflowNotification({
      companyId,
      userId: String(instance.submitted_by_id),
      instanceId: String(instance.id),
      taskId,
      type: 'DECISION',
      title: 'Workflow rejected',
      body: options?.comments ?? 'Your submission was rejected.',
    })
  }

  return task
}

export async function delegateWorkflowTask(
  taskId: string,
  delegateUserId: string,
  options?: { userId?: string; comments?: string; companyId?: string },
) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: task } = await client
    .from('workflow_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('company_id', companyId)
    .single()

  if (!task || task.status !== 'PENDING') throw new WorkflowError('Task not pending', 'INVALID_STATUS')

  await client.from('workflow_tasks').update({
    status: 'DELEGATED',
    acted_at: new Date().toISOString(),
    comments: options?.comments ?? null,
  }).eq('id', taskId)

  const { data: newTask, error } = await client
    .from('workflow_tasks')
    .insert({
      company_id: companyId,
      instance_id: task.instance_id,
      step_id: task.step_id,
      step_order: task.step_order,
      assignee_user_id: delegateUserId,
      delegated_from_user_id: options?.userId ?? task.assignee_user_id,
      status: 'PENDING',
      due_at: task.due_at,
    })
    .select('*')
    .single()

  if (error) throw error

  await writeHistory({
    companyId,
    instanceId: String(task.instance_id),
    taskId,
    action: 'DELEGATED',
    actorUserId: options?.userId,
    metadata: { delegateUserId },
    comments: options?.comments,
  })

  await createWorkflowNotification({
    companyId,
    userId: delegateUserId,
    instanceId: String(task.instance_id),
    taskId: String(newTask.id),
    type: 'ASSIGNMENT',
    title: 'Approval delegated to you',
    body: options?.comments ?? 'A workflow task was delegated to you.',
  })

  return newTask
}

export async function processWorkflowEscalationsAndReminders(companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const now = new Date()

  const { data: pendingTasks } = await client
    .from('workflow_tasks')
    .select('*, step:workflow_template_steps(*), instance:workflow_instances(*)')
    .eq('company_id', cid)
    .eq('status', 'PENDING')

  let reminders = 0
  let escalations = 0

  for (const task of pendingTasks ?? []) {
    const step = task.step as Record<string, unknown> | null
    if (!step) continue

    const reminderHours = step.reminder_hours != null ? Number(step.reminder_hours) : null
    const createdAt = new Date(String(task.created_at))
    const remindedAt = task.reminded_at ? new Date(String(task.reminded_at)) : null

    if (
      reminderHours
      && !remindedAt
      && now.getTime() - createdAt.getTime() >= reminderHours * 60 * 60 * 1000
    ) {
      await createWorkflowNotification({
        companyId: cid,
        userId: String(task.assignee_user_id),
        instanceId: String(task.instance_id),
        taskId: String(task.id),
        type: 'REMINDER',
        title: 'Approval reminder',
        body: 'You have a pending approval awaiting action.',
      })
      await client.from('workflow_tasks').update({ reminded_at: now.toISOString() }).eq('id', task.id)
      reminders++
    }

    if (task.due_at && !task.escalated_at && new Date(String(task.due_at)) <= now) {
      const escalationUserId = step.escalation_user_id as string | null
      if (escalationUserId) {
        await client.from('workflow_tasks').update({
          status: 'ESCALATED',
          escalated_at: now.toISOString(),
        }).eq('id', task.id)

        await client.from('workflow_tasks').insert({
          company_id: cid,
          instance_id: task.instance_id,
          step_id: task.step_id,
          step_order: task.step_order,
          assignee_user_id: escalationUserId,
          delegated_from_user_id: task.assignee_user_id,
          status: 'PENDING',
        })

        await createWorkflowNotification({
          companyId: cid,
          userId: escalationUserId,
          instanceId: String(task.instance_id),
          taskId: String(task.id),
          type: 'ESCALATION',
          title: 'Escalated approval',
          body: 'An overdue approval was escalated to you.',
        })
        escalations++
      }
    }
  }

  return { reminders, escalations }
}

export async function getWorkflowStatus(
  entityType: string,
  entityId: string,
  companyId?: string,
) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data } = await client
    .from('workflow_instances')
    .select('*, tasks:workflow_tasks(*)')
    .eq('company_id', cid)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle()
  return data
}
