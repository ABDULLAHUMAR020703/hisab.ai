# hisab.ai Supabase Migration

This repo is now prepared to run on Supabase Postgres instead of the local SQLite `dev.db`.

The migration kit contains:

- `supabase/migrations/001_extensions.sql` … `005_company_users.sql` — Phase A tenant + RLS schema
- `scripts/db/apply-supabase-migrations.mjs` — applies all migrations in order
- `scripts/db/apply-supabase-seed.mjs` — seeds default company
- `scripts/db/verify-supabase-db.mjs` — verifies Phase A tables and RLS
- `.env.supabase.example` - copy/paste template for Supabase connection strings.

## 1. Create The Supabase Project

1. Create a Supabase project.
2. Open the Supabase dashboard.
3. Go to **Project Settings > Database > Connection string** or click **Connect**.
4. Copy a Postgres connection string.

For Prisma, Supabase recommends using connection strings from the dashboard. Use session mode on port `5432` for persistent Node servers, and transaction mode on port `6543` for serverless-style deployments. Prisma CLI commands should use a direct/session connection through `DIRECT_URL`.

References:

- Supabase Prisma guide: https://supabase.com/docs/guides/database/prisma
- Supabase connection strings: https://supabase.com/docs/reference/postgres/connection-strings
- Prisma PostgreSQL connector: https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql

## 2. Create A Prisma Database User

Run this in Supabase SQL Editor. Replace the password first.

```sql
create user "prisma" with password 'replace_with_strong_password' bypassrls createdb;

grant usage on schema public to prisma;
grant create on schema public to prisma;
grant all privileges on all tables in schema public to prisma;
grant all privileges on all routines in schema public to prisma;
grant all privileges on all sequences in schema public to prisma;

alter default privileges in schema public grant all on tables to prisma;
alter default privileges in schema public grant all on routines to prisma;
alter default privileges in schema public grant all on sequences to prisma;
```

Use this user in `DATABASE_URL` and `DIRECT_URL`:

```text
postgresql://prisma.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

## 3. Configure Environment Variables

Copy the example file:

```powershell
Copy-Item .env.supabase.example .env
```

Then replace the placeholders:

```env
DATABASE_URL="postgresql://prisma.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://prisma.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
SUPABASE_DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
NEXTAUTH_SECRET="replace-with-a-long-random-secret"
NEXTAUTH_URL="http://localhost:3000"
```

`SUPABASE_DATABASE_URL` is only needed by the helper scripts. It can be the `postgres` owner connection or another role with permission to create public tables and seed `auth.users`.

## 4. Apply The Full SQL File

Option A: Supabase SQL Editor

1. Open `supabase/migrations/001_schema.sql`.
2. Paste it into Supabase SQL Editor.
3. Run it once.

Option B: Local script

```powershell
npm run supabase:apply
```

To point at a different SQL file:

```powershell
npm run supabase:migrate
npm run supabase:seed
npm run supabase:verify
```

## 5. Verify The Migration

```powershell
npm run supabase:verify
```

Expected base counts:

```text
User: 2
ChartOfAccount: 83
CompanySettings: 1
CostCenter: 5
TaxRate: 4
Sequence: 11
```

The transaction tables start empty because the current local `dev.db` has no customers, vendors, invoices, bills, expenses, payroll, inventory, receipts, payments, or journal entries.

## 6. Generate Prisma Client

```powershell
node scripts/db/prisma-generate.mjs
```

The repo uses dual database providers:

- **Local dev:** `prisma/schema.prisma` with `provider = "sqlite"` and `@prisma/adapter-better-sqlite3`
- **Staging/production:** `prisma/schema.postgresql.prisma` with `provider = "postgresql"` and `@prisma/adapter-pg`

`scripts/db/prisma-generate.mjs` selects the schema based on `DATABASE_URL`. See `.env.example`.

- `src/lib/prisma.ts` — runtime adapter selection
- `src/lib/database.ts` — provider detection helpers

## 7. Run The App

```powershell
npm run dev
```

Demo logins:

```text
admin@hisab.ai / admin123
accountant@hisab.ai / accountant123
```

The SQL also creates matching Supabase Auth users for these two accounts and links them to the app users through `User.authUserId`.

## Important Notes

- The current app still uses its existing custom cookie session table, `AppSession`, for route protection. Supabase Auth users are seeded and linked now so the database is ready for a follow-up UI/API auth conversion.
- Row Level Security is enabled in the SQL file for public tables. Server-side Prisma access should use the Prisma DB role. Browser-side Supabase Data API access will need additional policies per module before exposing financial data directly to clients.
- Do not run `prisma db push` against a database after manually editing schema in Supabase unless you understand the drift it may create. The provided SQL file is the source of truth for the initial Supabase bootstrap.
