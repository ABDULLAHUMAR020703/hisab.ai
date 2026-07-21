-- Invoice lines reference Cost Center master data for Project/Service and Class.
-- Keep project_service / class_name as denormalized display snapshots for PDF/history.

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS class_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_project_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD CONSTRAINT invoice_lines_project_id_fkey
      FOREIGN KEY (project_id)
      REFERENCES public.cost_centers(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_class_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD CONSTRAINT invoice_lines_class_id_fkey
      FOREIGN KEY (class_id)
      REFERENCES public.cost_centers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS invoice_lines_project_id_idx
  ON public.invoice_lines (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoice_lines_class_id_idx
  ON public.invoice_lines (class_id)
  WHERE class_id IS NOT NULL;
