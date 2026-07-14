-- Phase 1 multi-currency: per-transaction currency on bills, expenses, payments.
-- Uses companies.currency as primary currency; backfills existing rows.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR';

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR';

UPDATE public.bills b
SET currency = c.currency
FROM public.companies c
WHERE b.company_id = c.id
  AND b.currency = 'SAR'
  AND c.currency IS NOT NULL
  AND c.currency <> 'SAR';

UPDATE public.expenses e
SET currency = c.currency
FROM public.companies c
WHERE e.company_id = c.id
  AND e.currency = 'SAR'
  AND c.currency IS NOT NULL
  AND c.currency <> 'SAR';

UPDATE public.payments p
SET currency = COALESCE(i.currency, b.currency, c.currency, 'SAR')
FROM public.companies c
LEFT JOIN public.invoices i ON i.id = p.invoice_id
LEFT JOIN public.bills b ON b.id = p.bill_id
WHERE p.company_id = c.id
  AND p.currency = 'SAR'
  AND COALESCE(i.currency, b.currency, c.currency, 'SAR') <> 'SAR';
