-- Phase A: domain enums (aligned with Prisma schema + SaaS roles)

CREATE TYPE public.invoice_type AS ENUM (
  'STANDARD',
  'SIMPLIFIED',
  'CREDIT_NOTE',
  'DEBIT_NOTE'
);

CREATE TYPE public.zatca_environment AS ENUM (
  'SANDBOX',
  'PRODUCTION'
);

CREATE TYPE public.zatca_onboarding_status AS ENUM (
  'NOT_STARTED',
  'CSR_GENERATED',
  'COMPLIANCE_ISSUED',
  'COMPLIANCE_VALIDATED',
  'PRODUCTION_ISSUED',
  'PRODUCTION_READY',
  'FAILED'
);

CREATE TYPE public.zatca_invoice_status AS ENUM (
  'DRAFT',
  'PENDING',
  'SUBMITTED',
  'CLEARED',
  'REPORTED',
  'REJECTED',
  'FAILED'
);

CREATE TYPE public.company_role AS ENUM (
  'OWNER',
  'ADMIN',
  'ACCOUNTANT',
  'MANAGER',
  'EMPLOYEE',
  'AUDITOR'
);

CREATE TYPE public.subscription_plan AS ENUM (
  'FREE',
  'STARTER',
  'PROFESSIONAL',
  'ENTERPRISE'
);

CREATE TYPE public.subscription_status AS ENUM (
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED'
);

CREATE TYPE public.invitation_status AS ENUM (
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED'
);
