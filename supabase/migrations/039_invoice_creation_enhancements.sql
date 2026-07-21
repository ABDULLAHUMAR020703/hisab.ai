-- Invoice creation enhancements: tax calculation method, expiry, payment terms,
-- line project/class/item, tax config ZATCA mapping, dedicated attachments.
-- Backward compatible: new columns are nullable or defaulted.

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_calculation_method TEXT NOT NULL DEFAULT 'TAX_EXCLUSIVE',
  ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_term_id UUID REFERENCES public.payment_terms(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_tax_calculation_method_chk'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_tax_calculation_method_chk
      CHECK (tax_calculation_method IN ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE', 'OUT_OF_SCOPE'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- invoice_lines
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS project_service TEXT,
  ADD COLUMN IF NOT EXISTS class_name TEXT;

-- ---------------------------------------------------------------------------
-- tax_rates (tax configurations)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS zatca_mapping TEXT NOT NULL DEFAULT 'STANDARD_RATED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_rates_zatca_mapping_chk'
  ) THEN
    ALTER TABLE public.tax_rates
      ADD CONSTRAINT tax_rates_zatca_mapping_chk
      CHECK (zatca_mapping IN ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUTSIDE_SCOPE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_rates_rate_pct_chk'
  ) THEN
    ALTER TABLE public.tax_rates
      ADD CONSTRAINT tax_rates_rate_pct_chk
      CHECK (rate >= 0 AND rate <= 100);
  END IF;
END $$;

-- Seed standard tax configs per company (skip if name already exists)
INSERT INTO public.tax_rates (company_id, name, rate, type, category, zatca_mapping, is_default, is_active)
SELECT c.id, 'VAT 15%', 15, 'VAT', 'VAT', 'STANDARD_RATED', true, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rates tr
  WHERE tr.company_id = c.id AND tr.name = 'VAT 15%' AND tr.deleted_at IS NULL
);

INSERT INTO public.tax_rates (company_id, name, rate, type, category, zatca_mapping, is_default, is_active)
SELECT c.id, 'Zero Rated', 0, 'VAT', 'Zero Rated', 'ZERO_RATED', false, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rates tr
  WHERE tr.company_id = c.id AND tr.name = 'Zero Rated' AND tr.deleted_at IS NULL
);

INSERT INTO public.tax_rates (company_id, name, rate, type, category, zatca_mapping, is_default, is_active)
SELECT c.id, 'Exempt', 0, 'VAT', 'Exempt', 'EXEMPT', false, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rates tr
  WHERE tr.company_id = c.id AND tr.name = 'Exempt' AND tr.deleted_at IS NULL
);

INSERT INTO public.tax_rates (company_id, name, rate, type, category, zatca_mapping, is_default, is_active)
SELECT c.id, 'Outside Scope', 0, 'VAT', 'General Tax', 'OUTSIDE_SCOPE', false, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rates tr
  WHERE tr.company_id = c.id AND tr.name = 'Outside Scope' AND tr.deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- payment_terms seeds
-- ---------------------------------------------------------------------------
INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Due on Receipt', 0, 'Payment due on invoice date'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Due on Receipt'
);

INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Net 15', 15, 'Payment due in 15 days'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Net 15'
);

INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Net 30', 30, 'Payment due in 30 days'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Net 30'
);

INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Net 60', 60, 'Payment due in 60 days'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Net 60'
);

-- ---------------------------------------------------------------------------
-- invoice_attachments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT invoice_attachments_file_size_nonneg_chk CHECK (file_size >= 0),
  CONSTRAINT invoice_attachments_company_invoice_fk
    FOREIGN KEY (company_id, invoice_id)
    REFERENCES public.invoices (company_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invoice_attachments_invoice_id_idx
  ON public.invoice_attachments (invoice_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoice_attachments_company_id_idx
  ON public.invoice_attachments (company_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.invoice_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_attachments_tenant ON public.invoice_attachments;
CREATE POLICY invoice_attachments_tenant ON public.invoice_attachments FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

DROP POLICY IF EXISTS invoice_attachments_service ON public.invoice_attachments;
CREATE POLICY invoice_attachments_service ON public.invoice_attachments FOR ALL TO service_role
  USING (true) WITH CHECK (true);
