-- Production Readiness: Go-Live Wizard + Data Health Center
-- Soft-archive columns, company readiness fields, sessions, history, reports

-- ---------------------------------------------------------------------------
-- Company readiness / Production Live / opening balances / modules
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS production_live_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_live_by UUID,
  ADD COLUMN IF NOT EXISTS production_live_wizard_version TEXT,
  ADD COLUMN IF NOT EXISTS production_live_detection_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance_mode TEXT NOT NULL DEFAULT 'UNSET'
    CHECK (opening_balance_mode IN ('UNSET', 'EXISTING_BUSINESS', 'NEW_BUSINESS_ZERO')),
  ADD COLUMN IF NOT EXISTS opening_balance_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opening_balance_acknowledged_by UUID,
  ADD COLUMN IF NOT EXISTS readiness_modules JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Master data archive (enterprise Archive, not delete)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_archived_at ON public.customers (company_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_vendors_archived_at ON public.vendors (company_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_cost_centers_archived_at ON public.cost_centers (company_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_archived_at ON public.inventory_items (company_id, archived_at);

-- ---------------------------------------------------------------------------
-- Go-Live sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.go_live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'RUNNING', 'ANALYZED', 'PREVIEWED',
      'EXECUTED', 'EXECUTED_WITH_WARNINGS', 'FAILED', 'CANCELLED'
    )),
  wizard_version TEXT NOT NULL DEFAULT '1.0.0',
  detection_engine_version TEXT NOT NULL DEFAULT 'v1.0',
  idempotency_key TEXT,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB,
  analysis_cursor_json JSONB,
  cancel_requested_at TIMESTAMPTZ,
  analysis_json JSONB,
  selection_json JSONB,
  preview_json JSONB,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_go_live_sessions_company ON public.go_live_sessions (company_id, created_at DESC);

CREATE TRIGGER go_live_sessions_set_updated_at
  BEFORE UPDATE ON public.go_live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.go_live_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY go_live_sessions_tenant ON public.go_live_sessions
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- ---------------------------------------------------------------------------
-- Readiness score history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.readiness_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.go_live_sessions(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  verdict TEXT NOT NULL,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  checklist_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readiness_score_history_company
  ON public.readiness_score_history (company_id, recorded_at DESC);

ALTER TABLE public.readiness_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY readiness_score_history_tenant ON public.readiness_score_history
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- ---------------------------------------------------------------------------
-- Go-Live reports metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.go_live_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.go_live_sessions(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('ANALYSIS', 'PREVIEW', 'FINAL')),
  wizard_version TEXT,
  detection_engine_version TEXT,
  storage_path TEXT,
  checksum TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID,
  audit_log_id UUID
);

CREATE INDEX IF NOT EXISTS idx_go_live_reports_company
  ON public.go_live_reports (company_id, generated_at DESC);

ALTER TABLE public.go_live_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY go_live_reports_tenant ON public.go_live_reports
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- ---------------------------------------------------------------------------
-- Data Health scans / history / reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_health_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  engine_version TEXT NOT NULL DEFAULT 'v1.0',
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB,
  result_json JSONB,
  cancel_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_health_scans_company
  ON public.data_health_scans (company_id, created_at DESC);

CREATE TRIGGER data_health_scans_set_updated_at
  BEFORE UPDATE ON public.data_health_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.data_health_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_health_scans_tenant ON public.data_health_scans
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

CREATE TABLE IF NOT EXISTS public.data_health_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES public.data_health_scans(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  severity_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_health_score_history_company
  ON public.data_health_score_history (company_id, recorded_at DESC);

ALTER TABLE public.data_health_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_health_score_history_tenant ON public.data_health_score_history
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

CREATE TABLE IF NOT EXISTS public.data_health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES public.data_health_scans(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('SUMMARY', 'DETAIL', 'RECOMMENDATIONS', 'CATEGORY')),
  engine_version TEXT,
  storage_path TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_data_health_reports_company
  ON public.data_health_reports (company_id, generated_at DESC);

ALTER TABLE public.data_health_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_health_reports_tenant ON public.data_health_reports
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- ---------------------------------------------------------------------------
-- Atomic Go-Live execute RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_go_live_actions(
  p_company_id UUID,
  p_session_id UUID,
  p_executed_by UUID,
  p_idempotency_key TEXT,
  p_soft_delete_invoice_ids UUID[] DEFAULT '{}',
  p_archive_customer_ids UUID[] DEFAULT '{}',
  p_archive_vendor_ids UUID[] DEFAULT '{}',
  p_archive_product_ids UUID[] DEFAULT '{}',
  p_archive_cost_center_ids UUID[] DEFAULT '{}',
  p_numbering JSONB DEFAULT NULL,
  p_wizard_version TEXT DEFAULT '1.0.0',
  p_detection_engine_version TEXT DEFAULT 'v1.0',
  p_result JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.go_live_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_first_live BOOLEAN;
BEGIN
  SELECT * INTO v_session
  FROM public.go_live_sessions
  WHERE id = p_session_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'go_live_session_not_found';
  END IF;

  IF v_session.status IN ('EXECUTED', 'EXECUTED_WITH_WARNINGS')
     AND v_session.idempotency_key IS NOT NULL
     AND v_session.idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object(
      'idempotent', true,
      'status', v_session.status,
      'result', COALESCE(v_session.result_json, '{}'::jsonb)
    );
  END IF;

  IF v_session.status NOT IN ('ANALYZED', 'PREVIEWED') THEN
    RAISE EXCEPTION 'go_live_session_invalid_status:%', v_session.status;
  END IF;

  -- Soft-delete invoices (idempotent)
  IF cardinality(p_soft_delete_invoice_ids) > 0 THEN
    UPDATE public.invoices
    SET deleted_at = v_now, updated_at = v_now
    WHERE company_id = p_company_id
      AND id = ANY (p_soft_delete_invoice_ids)
      AND deleted_at IS NULL;
  END IF;

  IF cardinality(p_archive_customer_ids) > 0 THEN
    UPDATE public.customers
    SET archived_at = v_now, updated_at = v_now
    WHERE company_id = p_company_id
      AND id = ANY (p_archive_customer_ids)
      AND archived_at IS NULL
      AND deleted_at IS NULL;
  END IF;

  IF cardinality(p_archive_vendor_ids) > 0 THEN
    UPDATE public.vendors
    SET archived_at = v_now, updated_at = v_now
    WHERE company_id = p_company_id
      AND id = ANY (p_archive_vendor_ids)
      AND archived_at IS NULL
      AND deleted_at IS NULL;
  END IF;

  IF cardinality(p_archive_product_ids) > 0 THEN
    UPDATE public.inventory_items
    SET archived_at = v_now, updated_at = v_now
    WHERE company_id = p_company_id
      AND id = ANY (p_archive_product_ids)
      AND archived_at IS NULL
      AND deleted_at IS NULL;
  END IF;

  IF cardinality(p_archive_cost_center_ids) > 0 THEN
    UPDATE public.cost_centers
    SET archived_at = v_now, updated_at = v_now
    WHERE company_id = p_company_id
      AND id = ANY (p_archive_cost_center_ids)
      AND archived_at IS NULL
      AND deleted_at IS NULL;
  END IF;

  -- Optional numbering update
  IF p_numbering IS NOT NULL AND p_numbering ? 'documentType' THEN
    UPDATE public.document_sequences
    SET
      next_number = GREATEST(
        COALESCE((p_numbering->>'nextNumber')::BIGINT, next_number),
        1
      ),
      prefix = COALESCE(p_numbering->>'prefix', prefix),
      padding = COALESCE((p_numbering->>'padding')::INT, padding),
      suffix = COALESCE(p_numbering->>'suffix', suffix),
      updated_at = v_now
    WHERE company_id = p_company_id
      AND document_type = upper(p_numbering->>'documentType');
  END IF;

  -- Production Live: preserve first timestamp
  SELECT production_live_at IS NULL INTO v_first_live
  FROM public.companies WHERE id = p_company_id FOR UPDATE;

  IF v_first_live THEN
    UPDATE public.companies
    SET
      production_live_at = v_now,
      production_live_by = p_executed_by,
      production_live_wizard_version = p_wizard_version,
      production_live_detection_engine_version = p_detection_engine_version,
      updated_at = v_now
    WHERE id = p_company_id;
  ELSE
    UPDATE public.companies
    SET
      production_live_wizard_version = p_wizard_version,
      production_live_detection_engine_version = p_detection_engine_version,
      updated_at = v_now
    WHERE id = p_company_id;
  END IF;

  UPDATE public.go_live_sessions
  SET
    status = 'EXECUTED',
    idempotency_key = p_idempotency_key,
    result_json = p_result,
    selection_json = COALESCE(selection_json, '{}'::jsonb),
    updated_at = v_now
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'idempotent', false,
    'status', 'EXECUTED',
    'productionLiveFirst', v_first_live,
    'result', p_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_go_live_actions FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_go_live_actions TO service_role;
