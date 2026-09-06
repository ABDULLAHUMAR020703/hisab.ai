-- Immutable raw QuickBooks snapshot metadata. The raw entity JSON lives in the
-- private Supabase Storage bucket `quickbooks-migration`; these tables hold only
-- orchestration state and the manifest summary so migration can consume a
-- verified-COMPLETE snapshot without ever calling QuickBooks again.

CREATE TABLE IF NOT EXISTS public.quickbooks_migration_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','PARTIAL','COMPLETE','FAILED')),
  storage_bucket TEXT NOT NULL DEFAULT 'quickbooks-migration',
  storage_prefix TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  source_company JSONB,
  requested_resources TEXT[] NOT NULL DEFAULT '{}',
  -- { [resourceKey]: { status, entity, pages, records, files[], partitions?, error?, unsupportedReason?, unsupportedStatus? } }
  entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id, id)
);

CREATE INDEX IF NOT EXISTS quickbooks_migration_snapshots_company_idx
  ON public.quickbooks_migration_snapshots (company_id, realm_id, status, created_at DESC);

-- One extraction cursor per (snapshot, resource). Advanced only after the
-- corresponding raw page is durably written to Storage.
CREATE TABLE IF NOT EXISTS public.quickbooks_snapshot_checkpoints (
  snapshot_id UUID NOT NULL REFERENCES public.quickbooks_migration_snapshots(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  entity TEXT NOT NULL,
  extraction_mode TEXT NOT NULL DEFAULT 'full' CHECK (extraction_mode IN ('full','partitioned')),
  partition_start TIMESTAMPTZ,
  partition_end TIMESTAMPTZ,
  next_start_position BIGINT NOT NULL DEFAULT 1,
  pages_written INT NOT NULL DEFAULT 0,
  records_written BIGINT NOT NULL DEFAULT 0,
  last_page_file TEXT,
  -- Completed partition windows for boundary + duplicate validation:
  -- [ { start, end, records } ]
  partitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','unsupported')),
  last_error TEXT,
  unsupported_reason TEXT,
  unsupported_status INT,
  -- Attachments only: distinguishes metadata capture from binary-download outcome.
  -- { metadataRecords, binariesDownloaded, binariesFailed }
  attachment_summary JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, resource_key)
);

-- Mutable migration page-read position. Kept out of import_jobs.payload_snapshot
-- so job input config stays immutable.
CREATE TABLE IF NOT EXISTS public.quickbooks_snapshot_read_cursors (
  import_job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES public.quickbooks_migration_snapshots(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  next_page INT NOT NULL DEFAULT 1,
  records_read BIGINT NOT NULL DEFAULT 0,
  exhausted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (import_job_id, resource_key)
);

ALTER TABLE public.quickbooks_migration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_snapshot_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_snapshot_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY quickbooks_migration_snapshots_tenant ON public.quickbooks_migration_snapshots FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_migration_snapshots_service ON public.quickbooks_migration_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quickbooks_snapshot_checkpoints_tenant ON public.quickbooks_snapshot_checkpoints FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_snapshot_checkpoints_service ON public.quickbooks_snapshot_checkpoints FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY quickbooks_snapshot_read_cursors_tenant ON public.quickbooks_snapshot_read_cursors FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_snapshot_read_cursors_service ON public.quickbooks_snapshot_read_cursors FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Snapshot-backed migration jobs reference their source snapshot.
ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES public.quickbooks_migration_snapshots(id) ON DELETE SET NULL;

-- One active snapshot-extraction step per snapshot (mirrors the import-step
-- guard in 067). The next step is scheduled from the post-complete hook AFTER
-- the current step's row is COMPLETED, so a RUNNING row never has to co-exist
-- with the successor it schedules.
CREATE UNIQUE INDEX IF NOT EXISTS job_queue_one_active_quickbooks_snapshot_step_idx
  ON public.job_queue (company_id, job_type, (payload->>'snapshotId'))
  WHERE job_type = 'QUICKBOOKS_SNAPSHOT_STEP'
    AND status IN ('PENDING', 'RUNNING');

-- Private snapshot bucket already exists (migration 051). Re-assert it is private.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('quickbooks-migration', 'quickbooks-migration', false, 104857600)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;
