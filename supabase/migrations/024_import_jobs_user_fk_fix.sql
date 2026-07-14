-- Fix import_jobs.user_id FK: NOT NULL column cannot use ON DELETE SET NULL
-- Depends on: 023_import_export_framework

ALTER TABLE public.import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_user_id_fkey;

ALTER TABLE public.import_jobs
  ADD CONSTRAINT import_jobs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
