-- Credit/debit notes: link to the original tax invoice (business fact only).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS referenced_invoice_id UUID REFERENCES public.invoices(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS invoices_referenced_invoice_idx
  ON public.invoices (company_id, referenced_invoice_id)
  WHERE referenced_invoice_id IS NOT NULL;
