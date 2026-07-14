import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function resolveStepAssignees(
  companyId: string,
  step: Record<string, unknown>,
  context: { submitterId?: string | null },
): Promise<string[]> {
  const client = createAdminClient()
  const approvers = (step.approvers as Array<Record<string, unknown>> ?? [])
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))

  const userIds = new Set<string>()

  for (const approver of approvers) {
    const type = String(approver.approver_type ?? 'USER')

    if (type === 'USER' && approver.user_id) {
      userIds.add(String(approver.user_id))
      continue
    }

    if (type === 'ROLE' && approver.role) {
      const { data } = await client
        .from('company_users')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('role', approver.role)
        .eq('is_active', true)
      for (const row of data ?? []) userIds.add(String(row.user_id))
      continue
    }

    if (type === 'DEPARTMENT' && approver.department_id) {
      const { data: dept } = await client
        .from('departments')
        .select('name')
        .eq('id', approver.department_id)
        .maybeSingle()

      if (dept?.name) {
        const { data: employees } = await client
          .from('employees')
          .select('email')
          .eq('company_id', companyId)
          .eq('department_id', approver.department_id)
          .eq('is_active', true)
          .is('deleted_at', null)

        const emails = (employees ?? []).map((e) => String(e.email ?? '').toLowerCase()).filter(Boolean)
        if (emails.length > 0) {
          const { data: profiles } = await client
            .from('profiles')
            .select('id, email')
            .in('email', emails)
          for (const p of profiles ?? []) userIds.add(String(p.id))
        }
      }

      const { data: managers } = await client
        .from('company_users')
        .select('user_id')
        .eq('company_id', companyId)
        .in('role', ['MANAGER', 'ADMIN', 'OWNER'])
        .eq('is_active', true)
      for (const row of managers ?? []) userIds.add(String(row.user_id))
      continue
    }

    if (type === 'MANAGER') {
      const { data: managers } = await client
        .from('company_users')
        .select('user_id')
        .eq('company_id', companyId)
        .in('role', ['MANAGER', 'ADMIN', 'OWNER'])
        .eq('is_active', true)
      for (const row of managers ?? []) userIds.add(String(row.user_id))
    }
  }

  if (userIds.size === 0 && context.submitterId) {
    const { data: admins } = await client
      .from('company_users')
      .select('user_id')
      .eq('company_id', companyId)
      .in('role', ['OWNER', 'ADMIN'])
      .eq('is_active', true)
      .limit(1)
    if (admins?.[0]) userIds.add(String(admins[0].user_id))
  }

  return [...userIds]
}

export async function resolveActiveDelegate(
  companyId: string,
  userId: string,
): Promise<string | null> {
  const client = createAdminClient()
  const now = new Date().toISOString()
  const { data } = await client
    .from('workflow_delegations')
    .select('delegate_user_id')
    .eq('company_id', companyId)
    .eq('delegator_user_id', userId)
    .eq('is_active', true)
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.delegate_user_id ? String(data.delegate_user_id) : null
}
