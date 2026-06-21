# Route Coverage Report

Date: 2026-06-21

Legend: Repository means route calls `get*Repository()`. Prisma means route imports `@/lib/prisma` or calls `prisma.*`. Supabase means route directly calls Supabase APIs.

| Route | Methods | Read backend | Write backend | Provider/repository | Prisma | Supabase |
|---|---:|---|---|---|---|---|
| `/api/accounts` | GET, POST | repository + Prisma fallback | Prisma | partial | yes | no |
| `/api/accounts/[id]` | GET, PUT, DELETE | repository + Prisma fallback | Prisma | partial | yes | no |
| `/api/auth/login` | POST | Prisma | Prisma | no | yes | no |
| `/api/auth/logout` | POST | Prisma | Prisma | no | yes | no |
| `/api/bills` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/bills/import` | POST | Prisma | Prisma | no | yes | no |
| `/api/bills/[id]` | GET, PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/bills/[id]/payment` | POST | Prisma | Prisma | no | yes | no |
| `/api/cost-centers` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/cost-centers/[id]` | PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/customers` | GET, POST | provider | provider | yes | no | no direct |
| `/api/customers/[id]` | GET, PUT, DELETE | provider | provider | yes | no | no direct |
| `/api/dashboard` | GET | provider | n/a | yes | no | no direct |
| `/api/employees` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/employees/[id]` | GET, PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/expenses` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/expenses/import` | POST | Prisma | Prisma | no | yes | no |
| `/api/expenses/[id]` | GET, PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/inventory` | GET, POST | provider | Prisma | partial | yes | no |
| `/api/inventory/[id]` | GET, PUT, DELETE | provider | Prisma | partial | yes | no |
| `/api/invoices` | GET, POST | provider | provider | yes | no | no direct |
| `/api/invoices/[id]` | GET, PUT, DELETE | provider | provider | yes | no | no direct |
| `/api/invoices/[id]/payment` | POST | Prisma | Prisma | no | yes | no |
| `/api/invoices/[id]/pdf` | GET | Prisma | n/a | no | yes | no |
| `/api/journal` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/journal/import` | POST | Prisma | Prisma | no | yes | no |
| `/api/journal/[id]` | GET, PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/journal/[id]/post` | POST | Prisma | Prisma | no | yes | no |
| `/api/payroll` | GET, POST | provider + Prisma fallback | Prisma | partial | yes | no |
| `/api/payroll/[id]` | GET, PUT | provider + Prisma fallback | Prisma | partial | yes | no |
| `/api/payroll/[id]/approve` | POST | Prisma | Prisma | no | yes | no |
| `/api/receipts` | GET, POST | Prisma | Prisma + file upload | no | yes | direct file only |
| `/api/receipts/[id]` | GET, PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/reports/balance-sheet` | GET | Prisma | n/a | no | yes | no |
| `/api/reports/cash-flow` | GET | Prisma | n/a | no | yes | no |
| `/api/reports/general-ledger` | GET | Prisma | n/a | no | yes | no |
| `/api/reports/profit-loss` | GET | Prisma | n/a | no | yes | no |
| `/api/seed` | POST | Prisma | Prisma | no | yes | no |
| `/api/settings` | GET, PUT | provider | provider | yes | no | no direct |
| `/api/tax` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/tax/report` | GET | Prisma | n/a | no | yes | no |
| `/api/users` | GET, POST | Prisma | Prisma | no | yes | no |
| `/api/users/[id]` | PUT, DELETE | Prisma | Prisma | no | yes | no |
| `/api/vendors` | GET, POST | provider | provider | yes | no | no direct |
| `/api/vendors/[id]` | GET, PUT, DELETE | provider | provider | yes | no | no direct |
| `/api/zatca/dashboard` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/compliance` | GET | Prisma | n/a | no | yes | no |
| `/api/zatca/invoices/[id]/compliance-check` | POST | Prisma | Prisma/service | no | yes | no |
| `/api/zatca/invoices/[id]/hash` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/qr` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/response` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/signed-xml` | GET | Prisma | n/a | no | yes | no |
| `/api/zatca/invoices/[id]/status` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/submit` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/invoices/[id]/xml` | GET | service | n/a | no | service dependent | no direct |
| `/api/zatca/onboard` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/onboarding/compliance` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/onboarding/csr` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/onboarding/production` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/onboarding/status` | GET | Prisma | n/a | no | yes | no |
| `/api/zatca/onboarding/test-connection` | POST | Prisma | n/a | no | yes | no |
| `/api/zatca/sandbox/run` | POST | service | service | no | service dependent | no direct |
| `/api/zatca/verify/failure-scenarios` | GET | service | n/a | no | service dependent | no direct |

