# hisab.ai

A full-featured small-business accounting web application. Manage chart of accounts, sales and purchases, expenses, payroll, inventory, and financial reporting from a single dashboard.

Built with **Next.js 16**, **React 19**, **Prisma 7**, and **SQLite** — ideal for local development, demos, and small teams.

**Repository:** [github.com/ABDULLAHUMAR020703/hisab.ai](https://github.com/ABDULLAHUMAR020703/hisab.ai)

---

## Features

### Dashboard
- Live financial overview: revenue, costs, net profit, AR/AP
- Module counts across the entire app
- Recent activity feed and status breakdowns
- Revenue vs costs charts, AR aging, monthly profit
- Optional sample data loader for demos

### Accounting
- **Chart of accounts** — Hierarchical COA with 80+ pre-seeded accounts
- **Journal entries** — Draft and post double-entry transactions
- **Cost centers** — Branch, project, and department tracking

### Sales (Accounts Receivable)
- **Customers** — Contact details, payment terms, credit limits
- **Invoices** — Line items, VAT, statuses (Draft → Sent → Paid)
- **Payments** — Record customer payments against invoices

### Purchases (Accounts Payable)
- **Vendors** — Supplier directory
- **Bills** — Vendor invoices with line-level accounts
- **Payments** — Pay bills and track balances

### Operations
- **Expenses** — Categorized expenses with approval workflow
- **Receipts** — Upload and track receipt documents
- **Employees** — HR records and departments
- **Payroll** — Salary runs with earnings and deductions
- **Inventory** — Stock items, quantities, and pricing

### Reports
| Report | Description |
|--------|-------------|
| [Profit & Loss](http://localhost:3000/reports/profit-loss) | Revenue, COGS, expenses, net profit by period |
| [Balance Sheet](http://localhost:3000/reports/balance-sheet) | Assets, liabilities, and equity snapshot |
| [General Ledger](http://localhost:3000/reports/general-ledger) | Account-level transaction history |
| [Cash Flow](http://localhost:3000/reports/cash-flow) | Customer receipts vs vendor payments |

### Administration
- **Users** — Role-based accounts (Admin, Accountant)
- **Settings** — Company profile, currency (SAR), fiscal year
- **Tax & ZATCA** — VAT rates and tax reporting helpers

### Security
- Session-based authentication with HTTP-only cookies
- Protected API routes and dashboard layout

---

## Tech stack

| Layer | Technology |
|--------|------------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| UI | [React 19](https://react.dev), [Tailwind CSS 4](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com) |
| Charts | [Recharts](https://recharts.org) |
| Database | SQLite (`dev.db`) |
| ORM | [Prisma 7](https://www.prisma.io) + `better-sqlite3` adapter |
| Forms | [React Hook Form](https://react-hook-form.com) + [Zod](https://zod.dev) |
| Auth | Custom sessions (`bcryptjs` password hashing) |

---

## Prerequisites

- **Node.js** 20 or later (LTS recommended)
- **npm** 9+ (or pnpm / yarn)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) may be required for `better-sqlite3` native compilation

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/ABDULLAHUMAR020703/hisab.ai.git
cd hisab.ai
npm install
```

If `better-sqlite3` fails to load on Windows, rebuild native bindings:

```bash
npm rebuild better-sqlite3
```

### 2. Environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./dev.db"
```

> `.env` is gitignored. Never commit secrets or production credentials.

### 3. Database setup

```bash
npm run db:push
npm run db:seed
```

This creates the SQLite database, seeds the chart of accounts, users, tax rates, cost centers, and **demo transactions** (customers, invoices, bills, etc.) when the database is empty.

### 4. Run the development server

```bash
npm run dev
```

On **Windows**, if Turbopack fails with a native SWC error, use Webpack instead:

```bash
npm run dev -- --webpack
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 5. Sign in

| Role | Email | Password |
|------|--------|----------|
| Admin | `admin@hisab.ai` | `admin123` |
| Accountant | `accountant@hisab.ai` | `accountant123` |

> These accounts are for **development only**. Change or remove them before any public deployment.

You can also load sample data from the dashboard via **Load sample data** (calls `POST /api/seed`).

---

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run dev -- --webpack` | Dev server with Webpack (Windows fallback) |
| `npm run build` | Generate Prisma client and production build |
| `npm run start` | Run production server |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Apply Prisma schema to SQLite |
| `npm run db:seed` | Seed base + demo data (`prisma/seed.ts`) |
| `npm run db:studio` | Open [Prisma Studio](https://www.prisma.io/studio) |

---

## Project structure

```
hisab.ai/
├── prisma/
│   ├── schema.prisma      # Data models
│   └── seed.ts            # Database seed script
├── src/
│   ├── app/
│   │   ├── (auth)/        # Login
│   │   ├── (dashboard)/ # Main app pages
│   │   │   ├── page.tsx   # Dashboard
│   │   │   ├── accounts/
│   │   │   ├── invoices/
│   │   │   ├── bills/
│   │   │   ├── reports/   # P&L, balance sheet, GL, cash flow
│   │   │   └── ...
│   │   └── api/           # REST API route handlers
│   ├── components/        # Shared UI components
│   └── lib/               # Auth, Prisma, utilities, demo seed
├── dev.db                 # SQLite database (created after db:push)
├── prisma.config.ts       # Prisma CLI configuration
└── package.json
```

---

## API overview

REST-style handlers under `src/app/api/`:

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout` |
| Core | `/api/accounts`, `/api/journal`, `/api/cost-centers` |
| AR | `/api/customers`, `/api/invoices`, invoice payments |
| AP | `/api/vendors`, `/api/bills`, bill payments |
| Ops | `/api/expenses`, `/api/payroll`, `/api/employees`, `/api/inventory`, `/api/receipts` |
| Reports | `/api/reports/profit-loss`, `balance-sheet`, `general-ledger`, `cash-flow` |
| Dashboard | `GET /api/dashboard` |
| Admin | `/api/users`, `/api/settings`, `/api/tax`, `POST /api/seed` |

All protected routes require a valid `session` cookie.

---

## Deployment notes

- **SQLite:** The default setup stores data in `dev.db` at the project root. Serverless hosts (e.g. Vercel) need a **persistent volume** or a switch to PostgreSQL/MySQL.
- **Production database:** Update `prisma/schema.prisma` datasource and `DATABASE_URL`, then run migrations against the new provider.
- **Security:** Rotate default passwords, use HTTPS, and set secure cookie flags in production.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `'next' is not recognized` | Run `npm install` |
| `better-sqlite3` bindings error | Run `npm rebuild better-sqlite3` |
| Turbopack / SWC error on Windows | Use `npm run dev -- --webpack` |
| Dashboard shows zeros | Create transactions or use **Load sample data**; DRAFT records are included |
| `/reports/cash-flow` empty | Record payments on invoices or bills first |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## Author

**Abdul Samad Saleem** — [AbdulSamadSaleem1208](https://github.com/AbdulSamadSaleem1208)

---

## Acknowledgments

- [Next.js](https://nextjs.org/docs)
- [Prisma](https://www.prisma.io/docs)
- Pre-configured for **NETKOM COMPANY FOR COMMUNICATION** (Saudi Arabia, SAR)
