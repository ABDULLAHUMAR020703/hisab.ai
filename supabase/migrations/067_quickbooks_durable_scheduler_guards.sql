-- Durable ownership for one QuickBooks migration job per selected module and
-- one active queue step per import job. Both guards make worker retries and
-- duplicate completion hooks safe at the database boundary.
ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS migration_session_id UUID REFERENCES public.migration_wizard_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS migration_resource_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_one_resource_per_migration_idx
  ON public.import_jobs (migration_session_id, migration_resource_key)
  WHERE migration_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_queue_one_active_quickbooks_step_idx
  ON public.job_queue (company_id, job_type, (payload->>'importJobId'))
  WHERE job_type = 'QUICKBOOKS_IMPORT_STEP'
    AND status IN ('PENDING', 'RUNNING');

CREATE INDEX IF NOT EXISTS import_jobs_migration_session_idx
  ON public.import_jobs (migration_session_id, status, updated_at)
  WHERE migration_session_id IS NOT NULL;
