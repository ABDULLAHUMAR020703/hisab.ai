-- Phase C: migration traceability (SQLite cuid → Supabase UUID)
-- Depends on: 001_extensions

CREATE TABLE public.migration_id_map (
  entity_type TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  supabase_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, legacy_id)
);

CREATE INDEX migration_id_map_supabase_id_idx
  ON public.migration_id_map (supabase_id);

CREATE INDEX migration_id_map_entity_type_idx
  ON public.migration_id_map (entity_type);

COMMENT ON TABLE public.migration_id_map IS
  'Phase C — deterministic UUIDv5 map from Prisma cuids; populated by 016_import_supabase.ts';

-- Service role only (contains full tenant ID map)
ALTER TABLE public.migration_id_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY migration_id_map_service ON public.migration_id_map
  FOR ALL TO service_role USING (true) WITH CHECK (true);
