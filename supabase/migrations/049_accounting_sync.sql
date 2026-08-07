CREATE TABLE IF NOT EXISTS public.accounting_sync_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'import_only' CHECK (mode IN ('import_only', 'two_way')),
  conflict_strategy TEXT NOT NULL DEFAULT 'source_wins' CHECK (conflict_strategy IN ('source_wins', 'hisab_wins', 'manual')),
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  schedule_cron TEXT,
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE TABLE IF NOT EXISTS public.accounting_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  changes_detected INT NOT NULL DEFAULT 0,
  imported_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  conflict_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.accounting_sync_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  module_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}',
  local_record JSONB,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'imported', 'updated', 'conflict', 'ignored')),
  run_id UUID REFERENCES public.accounting_sync_runs(id) ON DELETE SET NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_sync_change_key_idx ON public.accounting_sync_changes (company_id, provider, module_key, source_id);
CREATE INDEX IF NOT EXISTS accounting_sync_runs_company_idx ON public.accounting_sync_runs (company_id, started_at DESC);
