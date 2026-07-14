'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Save, Trash2, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

const ENTITY_TYPES = [
  'INVOICE', 'BILL', 'EXPENSE', 'EXPENSE_CLAIM', 'PAYROLL', 'JOURNAL_ENTRY',
  'PURCHASE_ORDER', 'ESTIMATE', 'SALES_ORDER', 'DOCUMENT', 'VENDOR_CREDIT',
]

const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE', 'AUDITOR']

interface Template {
  id: string
  name: string
  description?: string | null
  entity_type: string
  is_active: boolean
}

interface TemplateDetail extends Template {
  steps?: Array<{
    id: string
    step_order: number
    name: string
    approval_mode: string
    parallel_policy: string
    amount_min?: number | null
    amount_max?: number | null
    escalation_hours?: number | null
    reminder_hours?: number | null
    approvers?: Array<{
      id: string
      sequence: number
      approver_type: string
      user_id?: string | null
      role?: string | null
      department_id?: string | null
    }>
  }>
}

interface Binding {
  id: string
  entity_type: string
  template_id: string
  priority: number
  is_active: boolean
  template?: { name?: string }
}

export default function WorkflowDesignerPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [bindings, setBindings] = useState<Binding[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newName, setNewName] = useState('')
  const [newEntityType, setNewEntityType] = useState('BILL')
  const [stepForm, setStepForm] = useState({
    name: 'Manager approval',
    stepOrder: 1,
    approvalMode: 'SEQUENTIAL',
    parallelPolicy: 'ALL',
    amountMin: '',
    amountMax: '',
    approverType: 'ROLE',
    approverRole: 'MANAGER',
    approverUserId: '',
  })
  const [bindingForm, setBindingForm] = useState({ entityType: 'BILL', templateId: '', priority: 100 })

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/workflows/templates')
    if (res.ok) {
      const data = await res.json()
      setTemplates(data.templates ?? [])
    }
  }, [])

  const loadBindings = useCallback(async () => {
    const res = await fetch('/api/workflows/bindings')
    if (res.ok) setBindings(await res.json())
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/workflows/templates/${id}`)
    if (res.ok) setDetail(await res.json())
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadTemplates(), loadBindings()])
      setLoading(false)
    }
    init()
  }, [loadTemplates, loadBindings])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  async function createTemplate() {
    if (!newName.trim()) return
    setSaving(true)
    const res = await fetch('/api/workflows/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), entityType: newEntityType }),
    })
    if (!res.ok) alert(await readApiError(res))
    else {
      setNewName('')
      await loadTemplates()
      const created = await res.json()
      setSelectedId(created.id)
    }
    setSaving(false)
  }

  async function addStep() {
    if (!selectedId) return
    setSaving(true)
    const approvers = stepForm.approverType === 'USER' && stepForm.approverUserId
      ? [{ approverType: 'USER', userId: stepForm.approverUserId }]
      : stepForm.approverType === 'ROLE'
        ? [{ approverType: 'ROLE', role: stepForm.approverRole }]
        : []

    const res = await fetch(`/api/workflows/templates/${selectedId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: stepForm.name,
        stepOrder: Number(stepForm.stepOrder),
        approvalMode: stepForm.approvalMode,
        parallelPolicy: stepForm.parallelPolicy,
        amountMin: stepForm.amountMin ? Number(stepForm.amountMin) : null,
        amountMax: stepForm.amountMax ? Number(stepForm.amountMax) : null,
        approvers,
      }),
    })
    if (!res.ok) alert(await readApiError(res))
    else await loadDetail(selectedId)
    setSaving(false)
  }

  async function createBinding() {
    if (!bindingForm.templateId) return
    setSaving(true)
    const res = await fetch('/api/workflows/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bindingForm),
    })
    if (!res.ok) alert(await readApiError(res))
    else {
      setBindingForm((f) => ({ ...f, templateId: '' }))
      await loadBindings()
    }
    setSaving(false)
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this workflow template?')) return
    const res = await fetch(`/api/workflows/templates/${id}`, { method: 'DELETE' })
    if (!res.ok) alert(await readApiError(res))
    else {
      if (selectedId === id) setSelectedId(null)
      await loadTemplates()
    }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Workflow Designer"
        subtitle="Configure approval templates, steps, hierarchies, and entity bindings — all stored in the database"
        breadcrumb={[
          { label: 'Administration' },
          { label: 'Workflows', href: '/workflows' },
          { label: 'Designer' },
        ]}
        action={(
          <Link href="/workflows" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            Approval Dashboard
          </Link>
        )}
      />

      {loading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold">New template</h3>
              <Input placeholder="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={newEntityType}
                onChange={(e) => setNewEntityType(e.target.value)}
              >
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button className="w-full" onClick={createTemplate} disabled={saving}>
                <Plus className="w-4 h-4 mr-2" /> Create template
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <h3 className="font-semibold mb-3">Templates</h3>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No templates yet.</p>
                ) : templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                      selectedId === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-muted-foreground">{t.entity_type}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {detail ? (
              <>
                <div className="rounded-xl border bg-card p-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">{detail.name}</h3>
                    <p className="text-sm text-muted-foreground">{detail.entity_type} · v{detail.id.slice(0, 8)}</p>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => deleteTemplate(detail.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="rounded-xl border bg-card p-4 space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <GitBranch className="w-4 h-4" /> Approval steps
                  </h3>
                  {(detail.steps ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No steps configured.</p>
                  ) : (
                    <div className="space-y-2">
                      {(detail.steps ?? [])
                        .sort((a, b) => a.step_order - b.step_order)
                        .map((step) => (
                          <div key={step.id} className="border rounded-lg p-3 text-sm">
                            <div className="font-medium">
                              {step.step_order}. {step.name}
                            </div>
                            <div className="text-muted-foreground">
                              {step.approval_mode} · {step.parallel_policy}
                              {(step.amount_min != null || step.amount_max != null) && (
                                <> · Amount {step.amount_min ?? 0}–{step.amount_max ?? '∞'}</>
                              )}
                            </div>
                            <div className="mt-1 text-xs">
                              Approvers: {(step.approvers ?? []).map((a) =>
                                `${a.approver_type}${a.role ? `:${a.role}` : ''}${a.user_id ? `:${a.user_id.slice(0, 8)}` : ''}`,
                              ).join(', ') || '—'}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t">
                    <Input placeholder="Step name" value={stepForm.name} onChange={(e) => setStepForm({ ...stepForm, name: e.target.value })} />
                    <Input type="number" placeholder="Step order" value={stepForm.stepOrder} onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })} />
                    <select className="border rounded-md px-3 py-2 text-sm" value={stepForm.approvalMode} onChange={(e) => setStepForm({ ...stepForm, approvalMode: e.target.value })}>
                      <option value="SEQUENTIAL">Sequential</option>
                      <option value="PARALLEL">Parallel</option>
                    </select>
                    <select className="border rounded-md px-3 py-2 text-sm" value={stepForm.parallelPolicy} onChange={(e) => setStepForm({ ...stepForm, parallelPolicy: e.target.value })}>
                      <option value="ALL">All must approve</option>
                      <option value="ANY">Any one approves</option>
                    </select>
                    <Input placeholder="Amount min (threshold)" value={stepForm.amountMin} onChange={(e) => setStepForm({ ...stepForm, amountMin: e.target.value })} />
                    <Input placeholder="Amount max (threshold)" value={stepForm.amountMax} onChange={(e) => setStepForm({ ...stepForm, amountMax: e.target.value })} />
                    <select className="border rounded-md px-3 py-2 text-sm" value={stepForm.approverType} onChange={(e) => setStepForm({ ...stepForm, approverType: e.target.value })}>
                      <option value="ROLE">By role</option>
                      <option value="USER">Specific user</option>
                      <option value="DEPARTMENT">Department</option>
                      <option value="MANAGER">Manager</option>
                    </select>
                    {stepForm.approverType === 'ROLE' ? (
                      <select className="border rounded-md px-3 py-2 text-sm" value={stepForm.approverRole} onChange={(e) => setStepForm({ ...stepForm, approverRole: e.target.value })}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <Input placeholder="User ID (if USER type)" value={stepForm.approverUserId} onChange={(e) => setStepForm({ ...stepForm, approverUserId: e.target.value })} />
                    )}
                    <Button className="md:col-span-2" onClick={addStep} disabled={saving}>
                      <Save className="w-4 h-4 mr-2" /> Add step
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                Select or create a template to configure approval steps.
              </div>
            )}

            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold">Entity bindings</h3>
              <p className="text-sm text-muted-foreground">
                Bind templates to document types with priority-based routing. Lower priority number runs first.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <select className="border rounded-md px-3 py-2 text-sm" value={bindingForm.entityType} onChange={(e) => setBindingForm({ ...bindingForm, entityType: e.target.value })}>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="border rounded-md px-3 py-2 text-sm md:col-span-2" value={bindingForm.templateId} onChange={(e) => setBindingForm({ ...bindingForm, templateId: e.target.value })}>
                  <option value="">Select template</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.entity_type})</option>)}
                </select>
                <Input type="number" placeholder="Priority" value={bindingForm.priority} onChange={(e) => setBindingForm({ ...bindingForm, priority: Number(e.target.value) })} />
              </div>
              <Button onClick={createBinding} disabled={saving || !bindingForm.templateId}>
                <Plus className="w-4 h-4 mr-2" /> Add binding
              </Button>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Entity</th>
                      <th className="text-left p-2">Template</th>
                      <th className="text-left p-2">Priority</th>
                      <th className="text-left p-2">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bindings.length === 0 ? (
                      <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No bindings</td></tr>
                    ) : bindings.map((b) => (
                      <tr key={b.id} className="border-t">
                        <td className="p-2">{b.entity_type}</td>
                        <td className="p-2">{b.template?.name ?? b.template_id}</td>
                        <td className="p-2">{b.priority}</td>
                        <td className="p-2">{b.is_active ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
