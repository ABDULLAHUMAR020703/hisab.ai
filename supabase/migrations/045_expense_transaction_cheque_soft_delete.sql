ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS cheques_company_active_idx ON public.cheques (company_id, issue_date DESC) WHERE deleted_at IS NULL;
