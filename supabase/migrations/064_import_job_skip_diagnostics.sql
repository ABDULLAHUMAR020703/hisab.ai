ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS skip_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.import_job_skips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  source_id TEXT,
  record_name TEXT,
  skip_reason TEXT NOT NULL,
  duplicate_key TEXT,
  existing_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS import_job_skips_job_idx ON public.import_job_skips (job_id, row_number);
ALTER TABLE public.import_job_skips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_job_skips' AND policyname = 'import_job_skips_tenant') THEN
    CREATE POLICY import_job_skips_tenant ON public.import_job_skips FOR ALL TO authenticated
      USING (company_id IN (SELECT public.user_company_ids()))
      WITH CHECK (company_id IN (SELECT public.user_company_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_job_skips' AND policyname = 'import_job_skips_service') THEN
    CREATE POLICY import_job_skips_service ON public.import_job_skips FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
