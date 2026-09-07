-- Storage-aware best-effort attachment capture for QuickBooks snapshots.
--
-- The production Supabase project is on the Free plan: 1 GB TOTAL project-wide
-- File Storage, shared across every bucket. A full NETKOM snapshot with all
-- attachment binaries measured at ~1.19 GB and cannot fit. Core accounting data
-- is captured first and is never sacrificed; attachment binaries are then
-- captured only within an application-enforced byte budget, and every candidate
-- is recorded as captured / skipped / failed so the snapshot stays auditable.

-- Per-attachment capture ledger. One row per QuickBooks Attachable considered
-- for a snapshot. Replaces the coarse { binariesDownloaded, binariesFailed }
-- counters that could not say WHICH attachments were captured.
CREATE TABLE IF NOT EXISTS public.quickbooks_snapshot_attachments (
  snapshot_id UUID NOT NULL REFERENCES public.quickbooks_migration_snapshots(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  attachable_id TEXT NOT NULL,
  -- The QuickBooks entity this attachment is linked to (first AttachableRef):
  -- { "type": "Invoice", "value": "101" }
  entity_ref JSONB,
  file_name TEXT,
  content_type TEXT,
  -- Attachable.Size as reported by QuickBooks (bytes); may be NULL / 0.
  source_size BIGINT,
  -- Path RELATIVE to the snapshot storage prefix, e.g.
  -- "attachments/5900061/receipt.pdf". Set only when status = 'captured'.
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','captured','skipped_budget','failed','unavailable')),
  reason TEXT,
  -- Actual bytes written to Storage (status = 'captured').
  captured_bytes BIGINT,
  -- sha256 hex of the captured bytes, for integrity validation.
  checksum TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, attachable_id)
);

CREATE INDEX IF NOT EXISTS quickbooks_snapshot_attachments_status_idx
  ON public.quickbooks_snapshot_attachments (snapshot_id, status);

ALTER TABLE public.quickbooks_snapshot_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY quickbooks_snapshot_attachments_tenant ON public.quickbooks_snapshot_attachments
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_snapshot_attachments_service ON public.quickbooks_snapshot_attachments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The storage-budget context for a snapshot's attachment phase, captured once
-- when that phase starts (after every non-attachment resource is terminal).
ALTER TABLE public.quickbooks_migration_snapshots
  ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT,
  -- Project-wide Storage usage measured at the start of the attachment phase
  -- (all buckets, includes this snapshot's already-written core JSON + manifest).
  ADD COLUMN IF NOT EXISTS storage_baseline_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_reserved_bytes BIGINT,
  -- max(0, quota - baseline - reserved). 0 => capture no binaries.
  ADD COLUMN IF NOT EXISTS attachment_budget_bytes BIGINT;
