# hisab.ai

Supabase-only accounting and ZATCA e-invoicing web app for Saudi businesses.

## Stack

| Layer | Technology |
| --- | --- |
| App | Next.js App Router, React, Tailwind CSS |
| API | Next.js route handlers |
| Data & Auth | Supabase (Postgres, Auth, RLS, Storage) |
| Deploy | Vercel |

No Prisma, SQLite, or direct Postgres connection strings.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Required environment variables (see `.env.example`):

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_SECRET=
ZATCA_CREDENTIAL_ENCRYPTION_KEY=
```

Apply SQL migrations from `supabase/migrations/` in order against your Supabase project.

## Commands

```bash
npm run dev                 # local development
npm run build               # production build
npm start                   # run production server
npm run lint

npm run test:invoices
npm run test:cost-centers
npm run test:document-numbering
npm run test:zatca
npm run test:import-export
npm run test:accounting
npm run test:production
```

## Product areas

- **Accounting** — chart of accounts, journals, ledgers, reports
- **Sales** — customers, invoices, estimates, sales orders, receipts
- **Purchasing** — vendors, bills, purchase orders, vendor credits
- **Cost centers** — Locations, Classes, Projects/Product-Service catalog
- **Inventory, payroll, banking, budgets**
- **Tax & ZATCA** — onboarding, CSID, clearance/reporting, monitoring
- **Settings** — company profile, branding, **Document Numbering**

## Recent capabilities

### Invoices
- Tax calculation methods, payment terms, expiry date, attachments
- Line items with Project/Service and Class (FK to cost centers)
- Unit Price auto-filled from Project **Cost** on selection
- Wider create/edit modal for line-item editing

### Cost centers
- Separate imports: Locations, Classes, Projects (Product/Service sheet)
- Excel footer/header metadata ignored
- Project import **upserts** by SKU (preferred) or name and updates Cost
- Cost visible in Cost Centers table and editable for Projects

### Document numbering
- Company-level `document_sequences` (migration `042`)
- Configurable prefix, next number, padding (e.g. `INV-000091`)
- Atomic allocation for concurrent invoice creation
- Settings → Document Numbering

## Project layout

```text
src/app                 # App Router pages + API routes
src/components          # UI
src/lib                 # Domain logic (invoices, cost-centers, ZATCA, numbering, …)
supabase/migrations     # Source of truth for schema
tests/                  # Unit/integration tests (tsx --test)
scripts/                # QA seed, ZATCA helpers, import-export fixtures
test-data/              # Generated import/export sample files
```

## Auth notes

- Supabase Auth users map to `profiles` / `company_users`
- Register at `/register`, sign in at `/login`
- Configure redirect URLs: `{APP_URL}/auth/callback` and `{APP_URL}/reset-password`

## Agent notes

Cursor/Claude agent guidance lives in `AGENTS.md` (and `CLAUDE.md`). This README is the only product documentation in the repo.
