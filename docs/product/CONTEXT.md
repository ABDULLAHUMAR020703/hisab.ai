# hisab.ai — Product Context & Current State

**Version:** 0.1.0  
**Last updated:** June 2026  
**Repository:** [github.com/ABDULLAHUMAR020703/hisab.ai](https://github.com/ABDULLAHUMAR020703/hisab.ai)  
**Local workspace folder:** `financebook` (legacy name; product branding is **hisab.ai**)

---

## Executive Summary

**hisab.ai** is a full-featured small-business accounting web application built for **NETKOM COMPANY FOR COMMUNICATION** in Saudi Arabia. It provides a single dashboard for chart of accounts, double-entry journaling, accounts receivable/payable, expenses, payroll, inventory, tax/VAT management, and financial reporting — all denominated in **SAR** with Saudi-market defaults (15% VAT, ZATCA-oriented settings).

The product is at **early MVP / demo maturity (v0.1.0)**. It ships a broad accounting surface area (~110 source files, 22 dashboard pages, 44 REST API routes) as a monolithic **Next.js 16** application backed by **SQLite** and **Prisma 7**.

> **Important:** The `.ai` in the name is **branding**, not current implementation. There are **no LLM, chatbot, OCR, or machine-learning integrations** in the codebase today. The tagline “Smart finance management” reflects product positioning, not deployed AI features.

---

## Product Vision & Naming

| Item | Value |
|------|-------|
| Product name | `hisab.ai` |
| npm package | `hisab-ai` |
| Tagline | Smart finance management |
| Meaning | *Hisab* (حساب) — accounting/bookkeeping in Arabic/Urdu; `.ai` signals intelligent, automated finance |

**Brand source of truth:** `src/lib/brand.ts`

The project evolved from an earlier “financebook” identity. Legacy references (e.g. `financebook.com` demo emails) are migrated to `@hisab.ai` domains in seed and demo-user code.

---

## Target Market & Users

### Primary market

- **Geography:** Saudi Arabia  
- **Currency:** SAR (Saudi Riyal)  
- **Compliance positioning:** VAT (15% default), ZATCA e-invoicing awareness in UI and settings  
- **Demo company:** NETKOM COMPANY FOR COMMUNICATION (telecom-themed sample customers: STC, Mobily, etc.)

### User roles

| Role | Email (demo) | Intended use |
|------|--------------|--------------|
| **ADMIN** | `admin@hisab.ai` | User management, company settings, tax configuration |
| **ACCOUNTANT** | `accountant@hisab.ai` | Day-to-day bookkeeping, journals, reports, payroll, inventory |

Demo passwords are shown on the login page and in the root README — **development only**.

### Use cases

1. **Small business / SME bookkeeping** — invoices, bills, expenses, payments  
2. **Financial reporting** — P&L, balance sheet, general ledger, cash flow  
3. **Operations** — payroll runs, employee records, inventory tracking, cost centers  
4. **Demos & portfolios** — pre-seeded Saudi telecom data, dashboard KPIs, sample-data loader  

---

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Framework | Next.js 16.2.6 (App Router) | Single full-stack app |
| UI | React 19, Tailwind CSS 4, Radix UI, Lucide icons | Dashboard-first design |
| Charts | Recharts | Revenue, costs, AR aging, profit trends |
| Database (runtime) | SQLite via `better-sqlite3` | File: `prisma/dev.db` |
| ORM | Prisma 7.8 + `@prisma/adapter-better-sqlite3` | |
| Forms / validation | React Hook Form + Zod | |
| Auth | Custom `AppSession` + `bcryptjs` | HTTP-only session cookie |
| Import | CSV (client-side parsing) | Expenses, bills, journal |
| Deployment target | Vercel-oriented | `vercel.json`, SQLite copy for serverless |

### Dependencies present but unused in application code

- `next-auth`, `@auth/prisma-adapter` — listed in `package.json`, not wired in `src/`
- `xlsx` — installed, no imports in app code (Excel import not implemented)

### Prepared but not default runtime

- **Supabase / PostgreSQL** — SQL bootstrap (`supabase/migrations/001_schema.sql`), migration scripts, and [SUPABASE.md](../migration/SUPABASE.md) exist; the running app still uses SQLite.

---

## Architecture

### High-level diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React)                       │
│  22 dashboard pages + login (client components)          │
└──────────────────────────┬──────────────────────────────┘
                           │ fetch()
┌──────────────────────────▼──────────────────────────────┐
│              Next.js App Router (src/app/)               │
│  • (auth)/login          • (dashboard)/* pages             │
│  • api/**/route.ts       • proxy.ts (route guard)        │
└──────────────────────────┬──────────────────────────────┘
                           │ requireAuth() + Prisma
┌──────────────────────────▼──────────────────────────────┐
│     SQLite (prisma/dev.db) via better-sqlite3 adapter    │
└─────────────────────────────────────────────────────────┘
```

**Pattern:** Monolithic Next.js — no separate backend service, no mobile app, no microservices.

### Key directories

```
financebook/
├── prisma/
│   ├── schema.prisma       # 20+ data models
│   ├── seed.ts             # COA, users, tax, demo transactions
│   └── dev.db              # SQLite database (gitignored in prod use)
├── src/
│   ├── app/
│   │   ├── (auth)/login/           # Login page
│   │   ├── (dashboard)/            # 22 feature pages
│   │   └── api/                    # 44 REST route handlers
│   ├── components/ui/              # Tables, modals, CSV import, etc.
│   ├── lib/                        # auth, prisma, brand, demo-seed, sequences
│   ├── proxy.ts                    # Redirect unauthenticated users to /login
│   └── instrumentation.ts          # Bootstraps demo users on server start
├── docs/                           # Product, migration, ZATCA, testing
├── scripts/db/                     # Prisma + Supabase helpers
├── supabase/migrations/            # Postgres schema SQL
├── scripts/                        # Supabase apply/verify helpers
└── supabase/migrations/001_schema.sql  # Postgres schema + seed SQL
```

### Request flow (example: record invoice payment)

1. User submits payment on `/invoices`
2. `POST /api/invoices/[id]/payment`
3. Creates `Payment` record; updates invoice `amountPaid`, `balance`, `status`
4. Dashboard and reports aggregate via Prisma queries on next load

### Authentication flow

1. `POST /api/auth/login` → bcrypt password verify → create `AppSession` → set HTTP-only `session` cookie  
2. `src/proxy.ts` blocks unauthenticated access to dashboard routes  
3. API routes call `requireAuth()` from `src/lib/auth.ts`  
4. **Note:** Roles are stored on `User` but **not enforced** at the API layer — any authenticated user can access all protected endpoints.

---

## Feature Inventory

### Dashboard (`/`)

| Capability | Status |
|------------|--------|
| KPI cards (revenue, costs, profit, AR/AP) | ✅ Implemented |
| Module counts across app | ✅ Implemented |
| Recent activity feed | ✅ Implemented |
| Charts (revenue vs costs, AR aging, monthly profit) | ✅ Implemented |
| Load sample data (`POST /api/seed`) | ✅ Implemented |

### Accounting

| Module | Route | API | Status | Notes |
|--------|-------|-----|--------|-------|
| Chart of Accounts | `/accounts` | `/api/accounts` | ✅ | 80+ hierarchical seeded accounts |
| Journal Entry | `/journal` | `/api/journal`, import, post | ⚠️ Partial | Create/edit/import work; **posting only changes status** — does not update `ChartOfAccount.balance` |
| Cost Centers | `/cost-centers` | `/api/cost-centers` | ✅ | Branch, project, department types |

### Sales (Accounts Receivable)

| Module | Route | API | Status | Notes |
|--------|-------|-----|--------|-------|
| Customers | `/customers` | `/api/customers` | ✅ | CRUD, credit limits, payment terms |
| Invoices | `/invoices` | `/api/invoices`, payments | ✅ | Line items, VAT, status workflow |
| Recurring invoices | — | — | ❌ Planned | Schema/UI checkbox only; no scheduler |

### Purchases (Accounts Payable)

| Module | Route | API | Status | Notes |
|--------|-------|-----|--------|-------|
| Vendors | `/vendors` | `/api/vendors` | ✅ | Supplier directory |
| Bills | `/bills` | `/api/bills`, import, payments | ✅ | Line-level accounts, CSV import |

### Operations

| Module | Route | API | Status | Notes |
|--------|-------|-----|--------|-------|
| Expenses | `/expenses` | `/api/expenses`, import | ✅ | Categories, approval via PUT |
| Receipts | `/receipts` | `/api/receipts` | ⚠️ Partial | Upload + metadata only; status stays `UNPROCESSED` |
| Employees | `/employees` | `/api/employees` | ✅ | HR records |
| Payroll | `/payroll` | `/api/payroll`, approve | ✅ | Runs with earnings/deductions lines |
| Inventory | `/inventory` | `/api/inventory` | ✅ | Stock, quantities, pricing |

### Reports

| Report | Page | API | Status |
|--------|------|-----|--------|
| Profit & Loss | `/reports/profit-loss` | `/api/reports/profit-loss` | ✅ |
| Balance Sheet | `/reports/balance-sheet` | `/api/reports/balance-sheet` | ✅ |
| General Ledger | `/reports/general-ledger` | `/api/reports/general-ledger` | ✅ |
| Cash Flow | `/reports/cash-flow` | `/api/reports/cash-flow` | ✅ (needs invoice/bill payments for data) |

### Administration

| Module | Route | API | Status | Notes |
|--------|-------|-----|--------|-------|
| Users | `/users` | `/api/users` | ✅ | CRUD; roles stored, not enforced on APIs |
| Settings | `/settings` | `/api/settings` | ✅ | Company profile, fiscal year, `zatcaEnabled` flag |
| Tax & VAT | `/tax` | `/api/tax`, `/api/tax/report` | ⚠️ Partial | Rate management + VAT summary; **no live ZATCA API** |

### Cross-cutting

| Capability | Status | Notes |
|------------|--------|-------|
| CSV import | ✅ | Expenses, bills, journal |
| Excel import (`xlsx`) | ❌ | Dependency unused |
| Session auth | ✅ | Custom cookies, not NextAuth |
| Role-based API permissions | ❌ | `requireAuth()` only |
| Notifications (header bell) | ❌ | Decorative UI only |

---

## AI Capabilities — Brand vs Reality

### What exists today

- Product name and domain: **hisab.ai**
- Marketing copy: “Smart finance management”
- Receipts page UI with camera/upload affordances (labeled as scanner-style workflow)
- File upload to `public/receipts/` with `UNPROCESSED` status

### What does not exist

- No OpenAI, Anthropic, LangChain, or other LLM SDKs
- No OCR or vision APIs for receipt parsing
- No chat or natural-language query interfaces
- No automated expense categorization or journal suggestion engine
- No ZATCA document generation via AI

### Natural extension points (not built)

1. **Receipt intelligence** — OCR + LLM extraction in `src/app/api/receipts/route.ts`
2. **Expense categorization** — suggest GL accounts from descriptions
3. **Report Q&A** — natural language over financial data
4. **ZATCA compliance** — automated e-invoice XML/QR generation

---

## Data Model

Prisma schema: `prisma/schema.prisma`

| Model | Purpose |
|-------|---------|
| `User` | Accounts with role (ADMIN / ACCOUNTANT) |
| `AppSession` | Session tokens for cookie auth |
| `ChartOfAccount` | Hierarchical GL accounts with balance field |
| `CostCenter` | Branch / project / department |
| `JournalEntry`, `JournalLine` | Double-entry transactions |
| `Customer`, `Invoice`, `InvoiceLine` | AR |
| `Vendor`, `Bill`, `BillLine` | AP |
| `Expense`, `ExpenseLine` | Operating expenses |
| `Payment` | Invoice and bill payments |
| `Employee`, `PayrollEntry`, `PayrollLine` | Payroll |
| `InventoryItem` | Stock management |
| `TaxRate` | VAT rate configuration |
| `Receipt` | Uploaded receipt documents |
| `CompanySettings` | Company profile, ZATCA toggle |
| `Sequence` | Document number sequences |

---

## API Surface

**44 route handlers** under `src/app/api/`:

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout` |
| Core | `/api/accounts`, `/api/journal`, `/api/journal/import`, `/api/journal/[id]/post`, `/api/cost-centers` |
| AR | `/api/customers`, `/api/invoices`, `/api/invoices/[id]/payment` |
| AP | `/api/vendors`, `/api/bills`, `/api/bills/import`, `/api/bills/[id]/payment` |
| Operations | `/api/expenses`, `/api/expenses/import`, `/api/payroll`, `/api/payroll/[id]/approve`, `/api/employees`, `/api/inventory`, `/api/receipts` |
| Reports | `/api/reports/profit-loss`, `balance-sheet`, `general-ledger`, `cash-flow` |
| Admin | `/api/users`, `/api/settings`, `/api/tax`, `/api/tax/report`, `/api/dashboard`, `POST /api/seed` |

All protected routes require a valid `session` cookie (auth and seed endpoints are exceptions per proxy configuration).

---

## Current Product State

### Maturity assessment: **Early demo / MVP (0.1.0)**

| Dimension | Rating | Summary |
|-----------|--------|---------|
| UI completeness | **High** | Polished dashboard, 22 pages, consistent component library |
| Feature breadth | **High** | Covers full SMB accounting checklist |
| Accounting depth | **Low–Medium** | Simplified engine; journal posting does not sync GL balances |
| Saudi compliance | **Low** | VAT UI and ZATCA flag; no Fatoorah/API integration |
| AI / automation | **None** | Branding only |
| Production readiness | **Low** | Demo auth, SQLite, no tests, minimal RBAC |
| Cloud / scale path | **Partial** | Supabase migration kit documented, not wired |

### What works well

- End-to-end CRUD for customers, vendors, invoices, bills, expenses, payroll, inventory
- Financial reports with real aggregated data from transactions
- Saudi-localized defaults (SAR, 15% VAT, Saudi bank COA, Riyadh/Dammam cost centers)
- Rich demo seed for presentations (`npm run db:seed`, dashboard “Load sample data”)
- CSV import for key modules
- Vercel deployment considerations (SQLite copied to temp dir in production via `src/lib/sqlite-db.ts`)

### Known limitations & gaps

| Gap | Impact |
|-----|--------|
| Journal post does not update account balances | GL balances may not reflect posted journals |
| ZATCA e-invoicing | Settings toggle and UI messaging only |
| Receipt “scanner” | Upload only; no processing pipeline |
| RBAC not enforced | All logged-in users have full API access |
| Dashboard header shows hardcoded “Admin” | Does not load live session user in layout |
| `next-auth` / `xlsx` unused | Dependency drift |
| Supabase docs vs runtime | Docs describe Postgres; app runs SQLite |
| No automated tests | No test suite in repository |
| No `.env.example` | README documents `DATABASE_URL` manually |
| Recurring invoices | Schema field only; no generation job |

---

## Roadmap Opportunities

Prioritized directions implied by branding, gaps, and market:

1. **Receipt AI pipeline** — OCR + structured extraction → expense draft  
2. **True double-entry engine** — posting updates `ChartOfAccount.balance`; tie invoices/bills to journals  
3. **ZATCA Phase 2 integration** — e-invoice XML, QR, API submission  
4. **Production auth** — Supabase Auth or NextAuth, RBAC on API routes  
5. **PostgreSQL / Supabase** — complete migration per [SUPABASE.md](../migration/SUPABASE.md)  
6. **AI assistant** — natural-language reports, anomaly detection, categorization suggestions  
7. **Recurring billing** — scheduler for invoice generation  
8. **Test coverage** — API and critical accounting flows  

---

## Development Quick Reference

See root [README.md](../README.md) for full setup.

```bash
npm install
# Create .env with DATABASE_URL="file:./dev.db"
npm run db:push
npm run db:seed
npm run dev
# Windows Turbopack issues: npm run dev -- --webpack
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server at localhost:3000 |
| `npm run build` | Prisma generate + production build |
| `npm run db:push` | Apply schema to SQLite |
| `npm run db:seed` | Seed COA, users, demo data |
| `npm run db:studio` | Prisma Studio GUI |

**Demo login:**

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@hisab.ai` | `admin123` |
| Accountant | `accountant@hisab.ai` | `accountant123` |

---

## Documentation Index

| File | Description |
|------|-------------|
| [docs/product/CONTEXT.md](./CONTEXT.md) | This document |
| [docs/migration/SUPABASE.md](../migration/SUPABASE.md) | Postgres / Supabase migration guide |
| [README.md](../README.md) | Setup, features, API overview, troubleshooting |
| [AGENTS.md](../AGENTS.md) | Next.js 16 agent development rules |
| [supabase/migrations/001_schema.sql](../supabase/migrations/001_schema.sql) | Full Postgres bootstrap SQL |

---

## Bottom Line

**hisab.ai** is a **Saudi-oriented small-business accounting SaaS MVP** — feature-broad, demo-ready, and built as a single Next.js web application. The **“.ai” name is aspirational**: today’s product is traditional CRUD accounting software with strong UI and demo data, not an AI-powered finance assistant. It is suitable for **local development, demos, and small-team prototyping**, with a documented path toward **Supabase/PostgreSQL** and future **AI and ZATCA** capabilities.

**Author:** Abdul Samad Saleem  
**Configured for:** NETKOM COMPANY FOR COMMUNICATION (Saudi Arabia, SAR)
