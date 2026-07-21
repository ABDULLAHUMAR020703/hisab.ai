-- Cost center enhancements for Location / Class / Project imports.
-- Projects (Product/Service) store full spreadsheet columns in metadata for future inventory/sales use.

ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS cost_centers_company_type_name_idx
  ON public.cost_centers (company_id, type, lower(name))
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_centers_type_chk'
  ) THEN
    ALTER TABLE public.cost_centers
      ADD CONSTRAINT cost_centers_type_chk
      CHECK (type IN ('LOCATION', 'CLASS', 'PROJECT'));
  END IF;
EXCEPTION
  WHEN check_violation THEN
    -- Existing rows may have other types; skip CHECK to keep backward compatibility
    NULL;
END $$;
