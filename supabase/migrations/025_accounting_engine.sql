-- Phase 1: Core accounting engine — ledger, fiscal periods, COA enhancements

CREATE TYPE public.canonical_account_type AS ENUM (
  'Asset',
  'Liability',
  'Equity',
  'Income',
  'Expense',
  'CostOfGoodsSold'
);

CREATE TYPE public.normal_balance AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE public.fiscal_period_status AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE public.ledger_source_type AS ENUM (
  'JOURNAL',
  'INVOICE',
  'BILL',
  'EXPENSE',
  'PAYMENT',
  'PAYROLL',
  'OPENING_BALANCE',
  'ADJUSTMENT'
);

-- COA enhancements (backwards-compatible)
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_type public.canonical_account_type,
  ADD COLUMN IF NOT EXISTS normal_balance public.normal_balance;

CREATE INDEX IF NOT EXISTS chart_of_accounts_parent_id_idx ON public.chart_of_accounts (parent_id);
CREATE INDEX IF NOT EXISTS chart_of_accounts_canonical_type_idx ON public.chart_of_accounts (company_id, canonical_type);

-- Map legacy account_type values to canonical types
UPDATE public.chart_of_accounts SET canonical_type = 'Asset' WHERE canonical_type IS NULL AND account_type IN (
  'Asset', 'Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset', 'Cash and Cash Equivalents'
);
UPDATE public.chart_of_accounts SET canonical_type = 'Liability' WHERE canonical_type IS NULL AND account_type IN (
  'Liability', 'Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'
);
UPDATE public.chart_of_accounts SET canonical_type = 'Equity' WHERE canonical_type IS NULL AND account_type IN ('Equity');
UPDATE public.chart_of_accounts SET canonical_type = 'Income' WHERE canonical_type IS NULL AND account_type IN ('Income', 'Other Income');
UPDATE public.chart_of_accounts SET canonical_type = 'Expense' WHERE canonical_type IS NULL AND account_type IN ('Expense', 'Expenses', 'Other Expense');
UPDATE public.chart_of_accounts SET canonical_type = 'CostOfGoodsSold' WHERE canonical_type IS NULL AND account_type IN (
  'CostOfGoodsSold', 'Cost of Goods Sold'
);
UPDATE public.chart_of_accounts SET canonical_type = 'Asset' WHERE canonical_type IS NULL;

-- Normal balance from canonical type
UPDATE public.chart_of_accounts SET normal_balance = 'DEBIT'
WHERE normal_balance IS NULL AND canonical_type IN ('Asset', 'Expense', 'CostOfGoodsSold');
UPDATE public.chart_of_accounts SET normal_balance = 'CREDIT'
WHERE normal_balance IS NULL AND canonical_type IN ('Liability', 'Equity', 'Income');

-- Backfill parent_id from parent_no
UPDATE public.chart_of_accounts child
SET parent_id = parent.id
FROM public.chart_of_accounts parent
WHERE child.parent_no IS NOT NULL
  AND child.parent_no = parent.account_no
  AND child.company_id = parent.company_id
  AND child.parent_id IS NULL;

-- Fiscal periods
CREATE TABLE public.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status public.fiscal_period_status NOT NULL DEFAULT 'OPEN',
  closed_at TIMESTAMPTZ,
  closed_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end)
);

CREATE INDEX fiscal_periods_company_id_idx ON public.fiscal_periods (company_id);
CREATE INDEX fiscal_periods_company_date_idx ON public.fiscal_periods (company_id, period_start, period_end);

CREATE TRIGGER fiscal_periods_set_updated_at
  BEFORE UPDATE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ledger entries (immutable posted GL)
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  journal_line_id UUID REFERENCES public.journal_lines(id) ON DELETE SET NULL,
  source_type public.ledger_source_type NOT NULL DEFAULT 'JOURNAL',
  source_id UUID,
  entry_date TIMESTAMPTZ NOT NULL,
  description TEXT,
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SAR',
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_debit_credit_nonneg_chk CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT ledger_entries_one_side_chk CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) OR (debit = 0 AND credit = 0)
  )
);

CREATE UNIQUE INDEX ledger_entries_journal_line_uidx ON public.ledger_entries (journal_line_id)
  WHERE journal_line_id IS NOT NULL;

CREATE INDEX ledger_entries_company_id_idx ON public.ledger_entries (company_id);
CREATE INDEX ledger_entries_company_account_date_idx ON public.ledger_entries (company_id, account_id, entry_date);
CREATE INDEX ledger_entries_company_date_idx ON public.ledger_entries (company_id, entry_date);
CREATE INDEX ledger_entries_source_idx ON public.ledger_entries (company_id, source_type, source_id);

-- Seed current-year fiscal period per company
INSERT INTO public.fiscal_periods (company_id, name, period_start, period_end, status)
SELECT
  c.id,
  EXTRACT(YEAR FROM now())::TEXT || ' Fiscal Year',
  date_trunc('year', now()),
  date_trunc('year', now()) + interval '1 year' - interval '1 second',
  'OPEN'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.fiscal_periods fp
  WHERE fp.company_id = c.id
    AND fp.period_start = date_trunc('year', now())
);

-- Post journal entry function
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_journal_id UUID, p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_line RECORD;
  v_closed BOOLEAN;
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

  FOR v_line IN
    SELECT jl.*
    FROM public.journal_lines jl
    WHERE jl.journal_id = p_journal_id
      AND jl.company_id = p_company_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.ledger_entries le WHERE le.journal_line_id = v_line.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ledger_entries (
      company_id, account_id, journal_entry_id, journal_line_id,
      source_type, source_id, entry_date, description,
      debit, credit, currency, cost_center_id
    ) VALUES (
      p_company_id, v_line.account_id, p_journal_id, v_line.id,
      'JOURNAL', p_journal_id, v_entry.date,
      COALESCE(v_line.description, v_entry.description),
      v_line.debit, v_line.credit, 'SAR', v_line.cost_center_id
    );

    UPDATE public.chart_of_accounts
    SET balance = balance + v_line.debit - v_line.credit,
        updated_at = now()
    WHERE id = v_line.account_id
      AND company_id = p_company_id;
  END LOOP;

  UPDATE public.journal_entries
  SET status = 'POSTED', updated_at = now()
  WHERE id = p_journal_id;
END;
$$;

-- Backfill ledger from already-posted journals
INSERT INTO public.ledger_entries (
  company_id, account_id, journal_entry_id, journal_line_id,
  source_type, source_id, entry_date, description,
  debit, credit, currency, cost_center_id, posted_at
)
SELECT
  jl.company_id,
  jl.account_id,
  je.id,
  jl.id,
  'JOURNAL'::public.ledger_source_type,
  je.id,
  je.date,
  COALESCE(jl.description, je.description),
  jl.debit,
  jl.credit,
  'SAR',
  jl.cost_center_id,
  COALESCE(je.updated_at, je.created_at)
FROM public.journal_lines jl
JOIN public.journal_entries je ON je.id = jl.journal_id
WHERE je.status = 'POSTED'
  AND je.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_entries le WHERE le.journal_line_id = jl.id
  );

-- Backfill account balances from ledger
UPDATE public.chart_of_accounts coa
SET balance = COALESCE(agg.net, 0),
    updated_at = now()
FROM (
  SELECT
    le.account_id,
    SUM(le.debit - le.credit) AS net
  FROM public.ledger_entries le
  GROUP BY le.account_id
) agg
WHERE coa.id = agg.account_id;

-- RLS
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY fiscal_periods_tenant ON public.fiscal_periods
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY ledger_entries_tenant ON public.ledger_entries
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
