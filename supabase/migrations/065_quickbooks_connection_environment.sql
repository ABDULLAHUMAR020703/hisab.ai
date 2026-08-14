-- Persist the QuickBooks environment that issued each accounting connection.
-- Legacy rows remain NULL and are treated as sandbox so they cannot be reused
-- as production connections after QB_ENVIRONMENT is switched.

ALTER TABLE public.accounting_integration_connections
  ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE public.accounting_integration_connections
  DROP CONSTRAINT IF EXISTS accounting_integration_connections_environment_check;

ALTER TABLE public.accounting_integration_connections
  ADD CONSTRAINT accounting_integration_connections_environment_check
  CHECK (environment IS NULL OR environment IN ('sandbox', 'production'));
