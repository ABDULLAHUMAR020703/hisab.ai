# Enterprise Workflow Engine

Migration `035_workflow_engine.sql` adds a fully database-driven approval workflow engine. No workflows are seeded — every company configures templates, steps, approvers, and bindings through the API or Workflow Designer UI.

## Features

| Capability | Implementation |
|------------|----------------|
| Approval templates | `workflow_templates` |
| Approval hierarchy | `workflow_template_steps` + `workflow_template_step_approvers` (ordered sequences) |
| Conditional approvals | JSON `conditions` on bindings and steps; evaluated in `conditions.ts` |
| Department approvals | `approver_type = DEPARTMENT` with `department_id` |
| Amount thresholds | `amount_min` / `amount_max` on steps |
| Parallel approvals | `approval_mode = PARALLEL` with `parallel_policy` ALL or ANY |
| Sequential approvals | `approval_mode = SEQUENTIAL` |
| Delegation | `workflow_delegations` + task `delegate` action |
| Escalation | `escalation_hours` / `escalation_user_id` on steps; processed by engine |
| Reminders | `reminder_hours` on steps; `workflow_notifications` |
| Notifications | `workflow_notifications` + dashboard view |
| Approval history | `workflow_history` immutable audit trail |
| Workflow designer | `/workflows/designer` |
| Approval dashboard | `/workflows` |

## Schema (migration 035)

- **workflow_templates** — reusable approval definitions per entity type
- **workflow_template_steps** — ordered steps with mode, thresholds, conditions, escalation/reminder config
- **workflow_template_step_approvers** — USER, ROLE, DEPARTMENT, or MANAGER assignees
- **workflow_bindings** — priority-based template routing per entity type with optional conditions
- **workflow_instances** — running workflow on a document
- **workflow_tasks** — per-approver tasks (approve / reject / delegate)
- **workflow_delegations** — standing delegation rules
- **workflow_history** — full audit log
- **workflow_notifications** — in-app notifications

## Library modules

| Module | Role |
|--------|------|
| `src/lib/workflow/types.ts` | Entity types, condition shapes |
| `src/lib/workflow/conditions.ts` | Pure condition + step completion logic |
| `src/lib/workflow/resolver.ts` | Binding → template resolution |
| `src/lib/workflow/assignees.ts` | Resolve approvers, apply delegations |
| `src/lib/workflow/engine.ts` | Submit, approve, reject, delegate, escalate, remind |
| `src/lib/workflow/notifications.ts` | Notification CRUD |
| `src/lib/workflow/integration.ts` | `maybeStartWorkflow`, document sync, post-approval hooks |

## APIs

| Endpoint | Purpose |
|----------|---------|
| `GET/POST /api/workflows/templates` | List / create templates |
| `GET/PATCH/DELETE /api/workflows/templates/[id]` | Template detail / update / soft-delete |
| `POST /api/workflows/templates/[id]/steps` | Add step with approvers |
| `GET/POST /api/workflows/bindings` | Entity → template bindings |
| `POST /api/workflows/submit` | Manual workflow submission |
| `POST /api/workflows/tasks/[id]` | Approve / reject / delegate |
| `GET /api/workflows/dashboard` | Pending tasks, submissions, history, notifications |
| `GET /api/workflows/instances` | Instance listing |
| `GET/POST /api/workflows/delegations` | Delegation rules |

## Document integration

Workflows start automatically when a binding exists for the entity type:

- Bills (`POST /api/bills`) — ledger posting deferred until approval
- Invoices (`POST /api/invoices`)
- Expenses (`POST /api/expenses`)
- Payroll (`POST /api/payroll`)
- Journal entries (`POST /api/journal`) — posting blocked until approved (`POST /api/journal/[id]/post`)
- Purchase orders (`POST /api/purchase-orders`)

On final approval, `onWorkflowApproved` posts to the ledger where applicable (bills, invoices, expenses, payroll, journals).

## UI

- **Approval Dashboard** — `/workflows` (sidebar: Administration → Approvals)
- **Workflow Designer** — `/workflows/designer`

## Tests

`tests/workflow/engine.test.ts` — condition evaluation, amount thresholds, parallel/sequential step completion.

Run: `npm run test:accounting`

## Setup

1. Apply migration `035_workflow_engine.sql` on Supabase.
2. Open Workflow Designer and create a template with steps and approvers.
3. Add an entity binding (e.g. `BILL` → your template).
4. Create a document — workflow instance and tasks are created automatically.

No hardcoded workflows. All routing, hierarchy, thresholds, and approvers are stored in the database.
