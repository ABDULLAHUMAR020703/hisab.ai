-- Configurable workflow / approval engine (database-driven, no hardcoded flows)

CREATE TYPE public.workflow_approval_mode AS ENUM ('SEQUENTIAL', 'PARALLEL');
CREATE TYPE public.workflow_parallel_policy AS ENUM ('ALL', 'ANY');
CREATE TYPE public.workflow_approver_type AS ENUM ('USER', 'ROLE', 'DEPARTMENT', 'MANAGER');
CREATE TYPE public.workflow_instance_status AS ENUM (
  'DRAFT',
  'PENDING',
  'IN_PROGRESS',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);
CREATE TYPE public.workflow_task_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'DELEGATED',
  'ESCALATED',
  'SKIPPED',
  'CANCELLED'
);
CREATE TYPE public.workflow_notification_type AS ENUM (
  'ASSIGNMENT',
  'REMINDER',
  'ESCALATION',
  'DECISION',
  'COMPLETED'
);

-- Reusable approval templates
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  entity_type TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, name, entity_type)
);

-- Steps within a template (hierarchy + thresholds + conditions)
CREATE TABLE IF NOT EXISTS public.workflow_template_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  step_order INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  approval_mode public.workflow_approval_mode NOT NULL DEFAULT 'SEQUENTIAL',
  parallel_policy public.workflow_parallel_policy NOT NULL DEFAULT 'ALL',
  amount_min NUMERIC(18, 4),
  amount_max NUMERIC(18, 4),
  conditions JSONB NOT NULL DEFAULT '{}',
  escalation_hours INT,
  escalation_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reminder_hours INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (template_id, step_order)
);

-- Approvers per step (configurable hierarchy)
CREATE TABLE IF NOT EXISTS public.workflow_template_step_approvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.workflow_template_steps(id) ON DELETE CASCADE,
  sequence INT NOT NULL DEFAULT 1,
  approver_type public.workflow_approver_type NOT NULL DEFAULT 'USER',
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  role public.company_role,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  UNIQUE (step_id, sequence)
);

-- Bind templates to entity types with conditional routing
CREATE TABLE IF NOT EXISTS public.workflow_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_bindings_lookup_idx
  ON public.workflow_bindings (company_id, entity_type, priority)
  WHERE is_active = true;

-- Running workflow on a document
CREATE TABLE IF NOT EXISTS public.workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  entity_label TEXT,
  status public.workflow_instance_status NOT NULL DEFAULT 'PENDING',
  current_step_order INT NOT NULL DEFAULT 1,
  document_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  submitted_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (company_id, entity_type, entity_id)
);

-- Individual approval tasks
CREATE TABLE IF NOT EXISTS public.workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.workflow_template_steps(id) ON DELETE RESTRICT,
  step_order INT NOT NULL,
  assignee_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  delegated_from_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.workflow_task_status NOT NULL DEFAULT 'PENDING',
  due_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  acted_at TIMESTAMPTZ,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_tasks_assignee_idx
  ON public.workflow_tasks (company_id, assignee_user_id, status);

-- User delegation rules
CREATE TABLE IF NOT EXISTS public.workflow_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  delegator_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delegate_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable approval history
CREATE TABLE IF NOT EXISTS public.workflow_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.workflow_tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT,
  comments TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_history_instance_idx
  ON public.workflow_history (instance_id, created_at DESC);

-- Notifications (assignments, reminders, escalations)
CREATE TABLE IF NOT EXISTS public.workflow_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.workflow_tasks(id) ON DELETE SET NULL,
  notification_type public.workflow_notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_notifications_user_idx
  ON public.workflow_notifications (company_id, user_id, read_at);

-- RLS
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_template_step_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_templates_tenant ON public.workflow_templates
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL);
CREATE POLICY workflow_template_steps_tenant ON public.workflow_template_steps
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_template_step_approvers_tenant ON public.workflow_template_step_approvers
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_bindings_tenant ON public.workflow_bindings
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_instances_tenant ON public.workflow_instances
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_tasks_tenant ON public.workflow_tasks
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_delegations_tenant ON public.workflow_delegations
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_history_tenant ON public.workflow_history
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY workflow_notifications_tenant ON public.workflow_notifications
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
