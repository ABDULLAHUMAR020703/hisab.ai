-- Phase A: company membership + RLS foundation

CREATE TABLE public.company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.company_role NOT NULL DEFAULT 'ACCOUNTANT',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX company_users_user_id_idx ON public.company_users (user_id);
CREATE INDEX company_users_company_id_idx ON public.company_users (company_id);

CREATE TRIGGER company_users_set_updated_at
  BEFORE UPDATE ON public.company_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS helper functions (public schema; callable by authenticated users)
CREATE OR REPLACE FUNCTION public.user_company_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.company_users
  WHERE user_id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.user_company_role(p_company_id UUID)
RETURNS public.company_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.company_users
  WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_has_company_role(
  p_company_id UUID,
  p_roles public.company_role[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_users
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
      AND role = ANY (p_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_company_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_company_role(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_company_role(UUID, public.company_role[]) TO authenticated, service_role;

-- Enable RLS on Phase A tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_zatca_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_onboarding_requests ENABLE ROW LEVEL SECURITY;

-- companies
CREATE POLICY companies_select ON public.companies
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_company_ids()));

CREATE POLICY companies_update ON public.companies
  FOR UPDATE TO authenticated
  USING (public.user_has_company_role(id, ARRAY['OWNER', 'ADMIN']::public.company_role[]))
  WITH CHECK (public.user_has_company_role(id, ARRAY['OWNER', 'ADMIN']::public.company_role[]));

CREATE POLICY companies_service_all ON public.companies
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- company_settings
CREATE POLICY company_settings_select ON public.company_settings
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY company_settings_update ON public.company_settings
  FOR UPDATE TO authenticated
  USING (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]))
  WITH CHECK (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]));

CREATE POLICY company_settings_service_all ON public.company_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- company_zatca_settings
CREATE POLICY company_zatca_settings_select ON public.company_zatca_settings
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[])
  );

CREATE POLICY company_zatca_settings_update ON public.company_zatca_settings
  FOR UPDATE TO authenticated
  USING (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]))
  WITH CHECK (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]));

CREATE POLICY company_zatca_settings_service_all ON public.company_zatca_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- company_subscriptions
CREATE POLICY company_subscriptions_select ON public.company_subscriptions
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[])
  );

CREATE POLICY company_subscriptions_service_all ON public.company_subscriptions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- company_users
CREATE POLICY company_users_select ON public.company_users
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY company_users_manage ON public.company_users
  FOR ALL TO authenticated
  USING (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[]))
  WITH CHECK (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[]));

CREATE POLICY company_users_service_all ON public.company_users
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR id IN (
    SELECT cu.user_id FROM public.company_users cu
    WHERE cu.company_id IN (SELECT public.user_company_ids())
  ));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_service_all ON public.profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- user_preferences
CREATE POLICY user_preferences_own ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_preferences_service_all ON public.user_preferences
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- invitations
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[])
  );

CREATE POLICY invitations_manage ON public.invitations
  FOR ALL TO authenticated
  USING (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[]))
  WITH CHECK (public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN']::public.company_role[]));

CREATE POLICY invitations_service_all ON public.invitations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- zatca_credentials (sensitive — service role writes during server onboarding until auth cutover)
CREATE POLICY zatca_credentials_select ON public.zatca_credentials
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[])
  );

CREATE POLICY zatca_credentials_service_all ON public.zatca_credentials
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- zatca_onboarding_requests
CREATE POLICY zatca_onboarding_requests_select ON public.zatca_onboarding_requests
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[])
  );

CREATE POLICY zatca_onboarding_requests_service_all ON public.zatca_onboarding_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
