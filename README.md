# hisab.ai Current State

hisab.ai is a Supabase-only accounting and ZATCA e-invoicing web app for NETKOM COMPANY FOR COMMUNICATION.

## Runtime

- Framework: Next.js 16 App Router
- UI: React 19, Tailwind CSS 4, Radix UI, Recharts
- Backend: Next.js API routes
- Database and auth: Supabase only
- Runtime database access: Supabase client with service-role server access where needed
- Authentication: Supabase Auth with HTTP-only app cookies
- Deployment target: Vercel

There is no Prisma runtime, SQLite database, Postgres direct connection string, or local database fallback.

## Environment

Use only these variables in Vercel and local `.env`:

```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project-ref.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"

APP_SECRET="replace-with-a-long-random-secret"

ZATCA_CREDENTIAL_ENCRYPTION_KEY="replace-with-a-long-random-secret"
ZATCA_MOCK_ONBOARDING=false
ZATCA_MOCK_SUBMISSION=false

# Optional
# ZATCA_API_BASE_URL="https://gw-fatoora.zatca.gov.sa"
```

Do not set these old variables:

```txt
DATABASE_URL
DIRECT_URL
SUPABASE_DATABASE_URL
USE_SUPABASE
DB_PARITY_CHECK
DUAL_WRITE
RUN_PRISMA_MIGRATE
NEXTAUTH_URL
NEXTAUTH_SECRET
```

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```

Available checks:

```bash
npx tsc --noEmit
npm run build
npm run test:zatca
```

## App Areas

- Dashboard and financial overview
- Chart of accounts
- Customers and vendors
- Invoices, bills, payments, expenses, receipts
- Employees, payroll, inventory
- Reports: profit/loss, balance sheet, cash flow, general ledger
- Users and company settings
- Tax and ZATCA monitoring
- ZATCA onboarding, CSID handling, sandbox simulation, invoice submission helpers

## Supabase Notes

- Supabase Auth users are mirrored into `profiles` and `company_users`.
- Server routes use Supabase service role for backend operations.
- RLS policies remain in Supabase migrations and protect authenticated tenant access.
- The default demo login is managed through Supabase Auth:

```txt
admin@hisab.ai
admin123
```

## Removed Legacy Stack

The previous Prisma/SQLite stack has been removed from active code and deployment:

- No `prisma/` schema or SQLite `dev.db`
- No Prisma client generation during install/build
- No direct Postgres connection strings in Vercel
- No dual-write or parity feature flags
- No SQLite seed flow

The app should be operated as Supabase-first and Supabase-only.
