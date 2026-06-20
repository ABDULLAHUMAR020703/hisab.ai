-- Optional seed: default tenant matching local NETKOM demo (run after migrations)
-- Safe to re-run (ON CONFLICT DO NOTHING)

INSERT INTO public.companies (
  id,
  slug,
  company_name,
  legal_name,
  tax_id,
  commercial_registration,
  street_address,
  building_number,
  district,
  city,
  postal_code,
  country,
  currency,
  fiscal_year_start
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'netkom',
  'NETKOM COMPANY FOR COMMUNICATION',
  'NETKOM COMPANY FOR COMMUNICATION',
  '311271112900003',
  '1010792495',
  'King Fahd Road',
  '7845',
  'Al Olaya',
  'Riyadh',
  '12211',
  'Saudi Arabia',
  'SAR',
  '01-01'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.company_settings (company_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_zatca_settings (company_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_subscriptions (company_id, plan, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'FREE', 'TRIAL')
ON CONFLICT (company_id) DO NOTHING;
