-- Phase 5: Banking module

CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  account_number TEXT,
  bank_name TEXT,
  currency TEXT NOT NULL DEFAULT 'SAR',
  opening_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  current_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  account_type TEXT NOT NULL DEFAULT 'BANK',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  transaction_date TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  amount NUMERIC(18, 4) NOT NULL,
  type TEXT NOT NULL DEFAULT 'DEBIT',
  status TEXT NOT NULL DEFAULT 'UNMATCHED',
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  imported_from TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  statement_date TIMESTAMPTZ NOT NULL,
  statement_balance NUMERIC(18, 4) NOT NULL,
  reconciled_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.bank_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  transfer_no TEXT NOT NULL,
  from_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  to_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18, 4) NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, transfer_no)
);

CREATE TABLE public.cheques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  cheque_no TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount NUMERIC(18, 4) NOT NULL,
  issue_date TIMESTAMPTZ NOT NULL,
  clearance_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX bank_accounts_company_id_idx ON public.bank_accounts (company_id);
CREATE INDEX bank_transactions_company_id_idx ON public.bank_transactions (company_id);
CREATE INDEX bank_reconciliations_company_id_idx ON public.bank_reconciliations (company_id);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_accounts_tenant ON public.bank_accounts FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY bank_transactions_tenant ON public.bank_transactions FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY bank_reconciliations_tenant ON public.bank_reconciliations FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY bank_transfers_tenant ON public.bank_transfers FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY cheques_tenant ON public.cheques FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
