-- ZATCA HTTP traceability: persist global transaction IDs and response payloads.

ALTER TABLE public.zatca_api_logs
  ADD COLUMN IF NOT EXISTS global_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS response_payload JSONB;

CREATE INDEX IF NOT EXISTS zatca_api_logs_global_txn_idx
  ON public.zatca_api_logs (company_id, global_transaction_id)
  WHERE global_transaction_id IS NOT NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_global_transaction_id TEXT;

CREATE INDEX IF NOT EXISTS invoices_zatca_global_txn_idx
  ON public.invoices (company_id, zatca_global_transaction_id)
  WHERE zatca_global_transaction_id IS NOT NULL;
