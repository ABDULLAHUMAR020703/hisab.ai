-- Company logo metadata + Supabase Storage bucket for branding assets.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS logo_uploaded_at TIMESTAMPTZ;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('company-files', 'company-files', true, 5242880)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DO $$
BEGIN
  CREATE POLICY company_files_public_read
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'company-files');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
