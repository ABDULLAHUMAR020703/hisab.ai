-- Tenant isolation verification for admin@hisab.ai vs mohsin.javaid@netkom.com.pk
-- Run in Supabase SQL editor after applying 020_mohsin_production_tenant_split.sql

-- 1) Both users exist
SELECT id, email
FROM auth.users
WHERE lower(email) IN ('admin@hisab.ai', 'mohsin.javaid@netkom.com.pk')
ORDER BY email;

-- 2) Memberships — must show different company_id values
SELECT
  u.email,
  cu.company_id,
  c.company_name,
  c.slug,
  cu.role,
  cu.is_active
FROM auth.users u
JOIN public.company_users cu ON cu.user_id = u.id
JOIN public.companies c ON c.id = cu.company_id
WHERE lower(u.email) IN ('admin@hisab.ai', 'mohsin.javaid@netkom.com.pk')
ORDER BY u.email, cu.created_at;

-- 3) Same company name, different IDs (allowed)
SELECT id, slug, company_name, tax_id, commercial_registration
FROM public.companies c
WHERE c.id IN (
  SELECT cu.company_id
  FROM public.company_users cu
  JOIN auth.users u ON u.id = cu.user_id
  WHERE lower(u.email) IN ('admin@hisab.ai', 'mohsin.javaid@netkom.com.pk')
    AND cu.is_active = true
)
ORDER BY created_at;

-- 4) Mohsin tenant must be empty (zero business rows)
WITH mohsin_company AS (
  SELECT cu.company_id AS id
  FROM public.company_users cu
  JOIN auth.users u ON u.id = cu.user_id
  WHERE lower(u.email) = 'mohsin.javaid@netkom.com.pk'
    AND cu.is_active = true
  LIMIT 1
)
SELECT 'invoices' AS entity, count(*)::int AS row_count FROM public.invoices i JOIN mohsin_company mc ON i.company_id = mc.id
UNION ALL
SELECT 'customers', count(*)::int FROM public.customers t JOIN mohsin_company mc ON t.company_id = mc.id
UNION ALL
SELECT 'vendors', count(*)::int FROM public.vendors t JOIN mohsin_company mc ON t.company_id = mc.id
UNION ALL
SELECT 'inventory_items', count(*)::int FROM public.inventory_items t JOIN mohsin_company mc ON t.company_id = mc.id
UNION ALL
SELECT 'journal_entries', count(*)::int FROM public.journal_entries t JOIN mohsin_company mc ON t.company_id = mc.id
UNION ALL
SELECT 'zatca_api_logs', count(*)::int FROM public.zatca_api_logs t JOIN mohsin_company mc ON t.company_id = mc.id;

-- 5) Admin dev tenant should still have data (if seeded)
WITH admin_company AS (
  SELECT cu.company_id AS id
  FROM public.company_users cu
  JOIN auth.users u ON u.id = cu.user_id
  WHERE lower(u.email) = 'admin@hisab.ai'
    AND cu.is_active = true
  LIMIT 1
)
SELECT 'invoices' AS entity, count(*)::int AS row_count FROM public.invoices i JOIN admin_company ac ON i.company_id = ac.id
UNION ALL
SELECT 'customers', count(*)::int FROM public.customers t JOIN admin_company ac ON t.company_id = ac.id;

-- 6) Mohsin must not remain on the dev company
SELECT count(*)::int AS mohsin_rows_on_dev_company
FROM public.company_users cu
JOIN auth.users u ON u.id = cu.user_id
WHERE lower(u.email) = 'mohsin.javaid@netkom.com.pk'
  AND cu.company_id = '00000000-0000-4000-8000-000000000001';
