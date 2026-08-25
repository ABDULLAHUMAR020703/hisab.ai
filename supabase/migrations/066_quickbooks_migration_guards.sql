-- Prevent concurrent active migrations for the same company. The application
-- still returns the existing active session on a uniqueness race.
CREATE UNIQUE INDEX IF NOT EXISTS migration_wizard_sessions_one_active_per_company_idx
  ON public.migration_wizard_sessions (company_id)
  WHERE status = 'IN_PROGRESS'
    AND config->>'kind' = 'quickbooks_migration';
