-- Phase A: tenant root + settings + ZATCA credential storage (schema only)

CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  commercial_registration TEXT,
  address TEXT,
  street_address TEXT,
  building_number TEXT,
  district TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'Saudi Arabia',
  phone TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'SAR',
  fiscal_year_start TEXT NOT NULL DEFAULT '01-01',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.company_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'ar-SA',
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER company_settings_set_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.company_zatca_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  zatca_enabled BOOLEAN NOT NULL DEFAULT false,
  zatca_connected BOOLEAN NOT NULL DEFAULT false,
  zatca_connected_at TIMESTAMPTZ,
  zatca_environment public.zatca_environment NOT NULL DEFAULT 'SANDBOX',
  zatca_egs_unit_id TEXT,
  zatca_device_identifier TEXT,
  zatca_egs_serial_number TEXT,
  zatca_business_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER company_zatca_settings_set_updated_at
  BEFORE UPDATE ON public.company_zatca_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.company_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  plan public.subscription_plan NOT NULL DEFAULT 'FREE',
  status public.subscription_status NOT NULL DEFAULT 'TRIAL',
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER company_subscriptions_set_updated_at
  BEFORE UPDATE ON public.company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ZATCA credentials (Prisma ZatcaCredential parity; company-scoped)
CREATE TABLE public.zatca_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  environment public.zatca_environment NOT NULL,
  egs_unit_id TEXT,
  csr TEXT,
  csr_enc TEXT,
  private_key_enc TEXT,
  certificate TEXT,
  certificate_enc TEXT,
  secret_enc TEXT,
  binary_security_token_enc TEXT,
  compliance_csid TEXT,
  request_id TEXT,
  production_csid TEXT,
  production_certificate TEXT,
  production_certificate_enc TEXT,
  onboarding_status public.zatca_onboarding_status NOT NULL DEFAULT 'NOT_STARTED',
  last_error TEXT,
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment)
);

CREATE INDEX zatca_credentials_company_env_idx
  ON public.zatca_credentials (company_id, environment);

CREATE TRIGGER zatca_credentials_set_updated_at
  BEFORE UPDATE ON public.zatca_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.zatca_onboarding_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  environment public.zatca_environment NOT NULL,
  egs_unit_id TEXT NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zatca_onboarding_requests_company_env_idx
  ON public.zatca_onboarding_requests (company_id, environment);

CREATE TRIGGER zatca_onboarding_requests_set_updated_at
  BEFORE UPDATE ON public.zatca_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
