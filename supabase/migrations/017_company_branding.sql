-- Optional company branding fields for invoice PDFs.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
