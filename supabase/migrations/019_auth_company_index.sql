-- Auth migration: registration and company ownership are handled in application code.
-- Supabase Auth users live in auth.users; profiles and company_users link tenants.
-- Ensure email auth is enabled in the Supabase dashboard and set Site URL / redirect URLs:
--   {APP_URL}/auth/callback
--   {APP_URL}/reset-password

-- Optional: index to speed up primary company lookup per user
CREATE INDEX IF NOT EXISTS company_users_user_active_idx
  ON public.company_users (user_id, is_active, created_at);
