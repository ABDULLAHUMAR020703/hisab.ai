-- Resumable background import jobs.
ALTER TABLE public.import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE public.import_jobs
  ADD CONSTRAINT import_jobs_status_check CHECK (status IN (
    'pending', 'parsing', 'mapping', 'validating', 'processing', 'paused',
    'completed', 'failed', 'cancelled'
  ));

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS payload_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS batch_size INT NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS batch_cursor INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS import_jobs_resume_idx
  ON public.import_jobs (status, last_heartbeat_at)
  WHERE status IN ('pending', 'processing', 'paused');
