-- Final ZATCA production hardening: production token, cert lifecycle, and response counters.

ALTER TABLE public.zatca_credentials
  ADD COLUMN IF NOT EXISTS production_binary_security_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS compliance_cert_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_cert_valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_cert_valid_to TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_cert_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_cert_valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_cert_valid_to TIMESTAMPTZ;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_warning_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zatca_error_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS zatca_credentials_cert_expiry_idx
  ON public.zatca_credentials (company_id, environment, compliance_cert_valid_to, production_cert_valid_to);

CREATE INDEX IF NOT EXISTS invoices_company_zatca_errors_idx
  ON public.invoices (company_id, zatca_error_count, zatca_warning_count)
  WHERE deleted_at IS NULL;
