-- Enterprise accounting hardening: immutable posting, sequences, audit, year close

CREATE TYPE public.journal_entry_type AS ENUM (
  'STANDARD',
  'REVERSING',
  'ADJUSTING',
  'CLOSING',
  'OPENING'
);

ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'REVERSAL';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'YEAR_CLOSE';

-- Journal entry metadata for enterprise operations
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS entry_type public.journal_entry_type NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS source_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_by_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posting_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS post_reason TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR';

CREATE INDEX IF NOT EXISTS journal_entries_source_journal_idx ON public.journal_entries (source_journal_id);
CREATE INDEX IF NOT EXISTS journal_entries_entry_type_idx ON public.journal_entries (company_id, entry_type);
CREATE INDEX IF NOT EXISTS journal_entries_posting_sequence_idx ON public.journal_entries (company_id, posting_sequence);

-- Ledger hardening
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS posting_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS reversal_of_ledger_id UUID REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_source_unique_idx
  ON public.ledger_entries (company_id, source_type, source_id, account_id, debit, credit, entry_date)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ledger_entries_posting_sequence_idx ON public.ledger_entries (company_id, posting_sequence);
CREATE INDEX IF NOT EXISTS ledger_entries_company_source_date_idx
  ON public.ledger_entries (company_id, source_type, entry_date DESC);

-- Immutable posting audit trail
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS before_state JSONB,
  ADD COLUMN IF NOT EXISTS after_state JSONB,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs (company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (company_id, action, created_at DESC);

-- Posting sequence per company (monotonic)
CREATE TABLE IF NOT EXISTS public.posting_sequences (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fiscal year closing records
CREATE TABLE IF NOT EXISTS public.fiscal_year_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL,
  period_id UUID REFERENCES public.fiscal_periods(id) ON DELETE SET NULL,
  net_income NUMERIC(18, 4) NOT NULL DEFAULT 0,
  closing_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  opening_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (company_id, fiscal_year)
);

CREATE INDEX fiscal_year_closings_company_idx ON public.fiscal_year_closings (company_id);

ALTER TABLE public.fiscal_year_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY fiscal_year_closings_tenant ON public.fiscal_year_closings
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- Next posting sequence (atomic)
CREATE OR REPLACE FUNCTION public.next_posting_sequence(p_company_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO public.posting_sequences (company_id, last_sequence)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_sequence = public.posting_sequences.last_sequence + 1,
        updated_at = now()
  RETURNING last_sequence INTO v_seq;
  RETURN v_seq;
END;
$$;

-- Prevent deleting accounts with ledger activity
CREATE OR REPLACE FUNCTION public.prevent_account_delete_with_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ledger_entries le
    WHERE le.account_id = OLD.id AND le.company_id = OLD.company_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot delete account with posted ledger transactions';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS chart_of_accounts_prevent_delete_with_ledger ON public.chart_of_accounts;
CREATE TRIGGER chart_of_accounts_prevent_delete_with_ledger
  BEFORE DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_account_delete_with_ledger();

-- Enhanced post_journal_entry with validation and sequence
-- Must drop first: PostgreSQL cannot change return type (VOID → BIGINT) via CREATE OR REPLACE
DROP FUNCTION IF EXISTS public.post_journal_entry(UUID, UUID);

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_journal_id UUID, p_company_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_line RECORD;
  v_closed BOOLEAN;
  v_seq BIGINT;
  v_account RECORD;
BEGIN
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = p_journal_id
    AND company_id = p_company_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;

  IF v_entry.status = 'POSTED' THEN
    RAISE EXCEPTION 'Already posted';
  END IF;

  IF v_entry.total_debit <> v_entry.total_credit THEN
    RAISE EXCEPTION 'Entry is not balanced';
  END IF;

  IF v_entry.total_debit <= 0 THEN
    RAISE EXCEPTION 'Entry must have non-zero amounts';
  END IF;

  -- Duplicate posting guard
  IF EXISTS (
    SELECT 1 FROM public.ledger_entries le
    WHERE le.journal_entry_id = p_journal_id AND le.company_id = p_company_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Duplicate posting prevented: ledger entries already exist for this journal';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_periods fp
    WHERE fp.company_id = p_company_id
      AND v_entry.date >= fp.period_start
      AND v_entry.date <= fp.period_end
      AND fp.status = 'CLOSED'
  ) INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'Fiscal period is closed';
  END IF;

  v_seq := public.next_posting_sequence(p_company_id);

  FOR v_line IN
    SELECT jl.*
    FROM public.journal_lines jl
    WHERE jl.journal_id = p_journal_id
      AND jl.company_id = p_company_id
  LOOP
    SELECT * INTO v_account
    FROM public.chart_of_accounts
    WHERE id = v_line.account_id
      AND company_id = p_company_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found or deleted: %', v_line.account_id;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Account is inactive: %', v_account.account_no;
    END IF;

    IF (v_line.debit > 0 AND v_line.credit > 0) OR (v_line.debit = 0 AND v_line.credit = 0) THEN
      RAISE EXCEPTION 'Journal line must be debit OR credit, not both or neither';
    END IF;

  INSERT INTO public.ledger_entries (
      company_id, account_id, journal_entry_id, journal_line_id,
      source_type, source_id, entry_date, description,
      debit, credit, currency, cost_center_id, posting_sequence
    ) VALUES (
      p_company_id, v_line.account_id, p_journal_id, v_line.id,
      CASE v_entry.entry_type
        WHEN 'REVERSING' THEN 'REVERSAL'::public.ledger_source_type
        WHEN 'CLOSING' THEN 'YEAR_CLOSE'::public.ledger_source_type
        WHEN 'OPENING' THEN 'OPENING_BALANCE'::public.ledger_source_type
        WHEN 'ADJUSTING' THEN 'ADJUSTMENT'::public.ledger_source_type
        ELSE 'JOURNAL'::public.ledger_source_type
      END,
      p_journal_id, v_entry.date,
      COALESCE(v_line.description, v_entry.description),
      v_line.debit, v_line.credit, COALESCE(v_entry.currency, 'SAR'), v_line.cost_center_id,
      v_seq
    );

    UPDATE public.chart_of_accounts
    SET balance = balance + v_line.debit - v_line.credit,
        updated_at = now()
    WHERE id = v_line.account_id
      AND company_id = p_company_id;
  END LOOP;

  UPDATE public.journal_entries
  SET status = 'POSTED',
      posting_sequence = v_seq,
      updated_at = now()
  WHERE id = p_journal_id;

  RETURN v_seq;
END;
$$;
