-- Durable progress and activity data for the enterprise migration dashboard.
ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS progress_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_events JSONB NOT NULL DEFAULT '[]'::jsonb;
