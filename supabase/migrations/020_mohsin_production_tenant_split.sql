-- Split mohsin.javaid@netkom.com.pk into an isolated production tenant.
-- Safe to re-run: skips when Mohsin already owns a company other than the dev tenant.
--
-- What this does:
--   1. Creates a new companies row (new UUID, unique slug)
--   2. Copies company master data (name, VAT, CR, address, currency, etc.)
--   3. Seeds empty tenant shell (settings / zatca shell / subscription)
--   4. Removes Mohsin from the dev company
--   5. Links Mohsin as OWNER of the new company
--
-- What this does NOT copy:
--   invoices, customers, vendors, inventory, journal entries, payroll,
--   ZATCA credentials, API logs, audit logs, branding/logo assets, users

DO $$
DECLARE
  v_dev_company_id UUID := '00000000-0000-4000-8000-000000000001';
  v_mohsin_email TEXT := 'mohsin.javaid@netkom.com.pk';
  v_mohsin_user_id UUID;
  v_existing_owner_company_id UUID;
  v_new_company_id UUID := gen_random_uuid();
  v_dev_company public.companies%ROWTYPE;
BEGIN
  SELECT id
  INTO v_mohsin_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_mohsin_email)
  LIMIT 1;

  IF v_mohsin_user_id IS NULL THEN
    RAISE NOTICE 'User % not found — no changes made', v_mohsin_email;
    RETURN;
  END IF;

  SELECT cu.company_id
  INTO v_existing_owner_company_id
  FROM public.company_users cu
  WHERE cu.user_id = v_mohsin_user_id
    AND cu.role = 'OWNER'
    AND cu.is_active = true
    AND cu.company_id <> v_dev_company_id
  LIMIT 1;

  IF v_existing_owner_company_id IS NOT NULL THEN
    RAISE NOTICE 'Mohsin already owns isolated tenant % — no changes made', v_existing_owner_company_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_users cu
    WHERE cu.user_id = v_mohsin_user_id
      AND cu.company_id = v_dev_company_id
      AND cu.is_active = true
  ) THEN
    RAISE NOTICE 'Mohsin is not an active member of dev company % — review manually', v_dev_company_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_dev_company
  FROM public.companies
  WHERE id = v_dev_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dev company % not found', v_dev_company_id;
  END IF;

  INSERT INTO public.companies (
    id,
    slug,
    company_name,
    legal_name,
    tax_id,
    commercial_registration,
    address,
    street_address,
    building_number,
    district,
    city,
    postal_code,
    country,
    phone,
    email,
    currency,
    fiscal_year_start,
    website,
    is_active
  ) VALUES (
    v_new_company_id,
    'netkom-production-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_dev_company.company_name,
    v_dev_company.legal_name,
    v_dev_company.tax_id,
    v_dev_company.commercial_registration,
    v_dev_company.address,
    v_dev_company.street_address,
    v_dev_company.building_number,
    v_dev_company.district,
    v_dev_company.city,
    v_dev_company.postal_code,
    v_dev_company.country,
    v_dev_company.phone,
    v_dev_company.email,
    v_dev_company.currency,
    v_dev_company.fiscal_year_start,
    v_dev_company.website,
    true
  );

  INSERT INTO public.company_settings (company_id, locale, timezone, invoice_prefix)
  SELECT
    v_new_company_id,
    COALESCE(cs.locale, 'ar-SA'),
    COALESCE(cs.timezone, 'Asia/Riyadh'),
    COALESCE(cs.invoice_prefix, 'INV-')
  FROM public.company_settings cs
  WHERE cs.company_id = v_dev_company_id;

  IF NOT EXISTS (SELECT 1 FROM public.company_settings WHERE company_id = v_new_company_id) THEN
    INSERT INTO public.company_settings (company_id) VALUES (v_new_company_id);
  END IF;

  INSERT INTO public.company_zatca_settings (company_id, zatca_enabled, zatca_connected, zatca_business_category)
  SELECT
    v_new_company_id,
    false,
    false,
    cz.zatca_business_category
  FROM public.company_zatca_settings cz
  WHERE cz.company_id = v_dev_company_id;

  IF NOT EXISTS (SELECT 1 FROM public.company_zatca_settings WHERE company_id = v_new_company_id) THEN
    INSERT INTO public.company_zatca_settings (company_id) VALUES (v_new_company_id);
  END IF;

  INSERT INTO public.company_subscriptions (company_id, plan, status)
  VALUES (v_new_company_id, 'FREE', 'TRIAL');

  DELETE FROM public.company_users
  WHERE user_id = v_mohsin_user_id
    AND company_id = v_dev_company_id;

  INSERT INTO public.company_users (company_id, user_id, role, is_active)
  VALUES (v_new_company_id, v_mohsin_user_id, 'OWNER', true)
  ON CONFLICT (company_id, user_id)
  DO UPDATE SET role = 'OWNER', is_active = true;

  RAISE NOTICE 'Mohsin production tenant created: %', v_new_company_id;
END $$;
