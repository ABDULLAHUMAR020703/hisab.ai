-- ZATCA credential hardening: encrypted credentials are service-role only.
-- Application code reads/writes zatca_credentials via the Supabase admin client.
-- Authenticated users must use backend APIs that return metadata only.

DROP POLICY IF EXISTS zatca_credentials_select ON public.zatca_credentials;

-- Documented policy change:
--   REMOVED: zatca_credentials_select (authenticated SELECT on ciphertext columns)
--   RETAINED: zatca_credentials_service_all (service_role ALL)
