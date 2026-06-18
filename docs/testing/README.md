# QA & Testing

Testing documentation for **hisab.ai** — audits, test cases, plans, and go-live checklists.

| Document | Description |
|----------|-------------|
| [COMPLETE_APPLICATION_AUDIT.md](./COMPLETE_APPLICATION_AUDIT.md) | Full feature, route, API, and database inventory |
| [TEST_CASES.md](./TEST_CASES.md) | Structured test cases by module (85+) |
| [MANUAL_TESTING_GUIDE.md](./MANUAL_TESTING_GUIDE.md) | Step-by-step guide for non-technical testers |
| [API_TEST_PLAN.md](./API_TEST_PLAN.md) | All API endpoints with examples and Postman structure |
| [DATABASE_TEST_PLAN.md](./DATABASE_TEST_PLAN.md) | Integrity checks, SQL queries, FK/cascade tests |
| [ZATCA_TESTING_GUIDE.md](./ZATCA_TESTING_GUIDE.md) | ZATCA onboarding, invoice, compliance, and failure tests |
| [AUTOMATION_PLAN.md](./AUTOMATION_PLAN.md) | Vitest/Playwright roadmap and CI recommendations |
| [SECURITY_TEST_PLAN.md](./SECURITY_TEST_PLAN.md) | Auth, credentials, exposure, and deployment security |
| [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) | Production release sign-off checklist |

**QA commands:** `npm run qa:seed` (test data) · `npm run qa:verify` (DB integrity) · `data/qa-company-profiles.json` (3 company profiles for Settings)

See also the main [docs index](../README.md).
