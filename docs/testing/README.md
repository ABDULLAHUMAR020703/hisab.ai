# QA & Testing

| Document | Description |
|----------|-------------|
| [MANUAL_TESTING_GUIDE.md](./MANUAL_TESTING_GUIDE.md) | Step-by-step guide for manual testers |
| [ZATCA_TESTING_GUIDE.md](./ZATCA_TESTING_GUIDE.md) | ZATCA onboarding, invoice, and compliance tests |
| [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) | Production release sign-off |

**Commands**

| Command | Purpose |
|---------|---------|
| `npm run qa:seed` | Load QA test data |
| `npm run qa:verify` | Database integrity checks |
| `npm run test:zatca` | ZATCA onboarding unit tests |
| `npm run zatca:sandbox` | Mock E2E sandbox scenarios |
| `npm run zatca:verify` | Phase 7 offline verification |

**Fixtures:** `tests/fixtures/qa-company-profiles.json` — sample company profiles for Settings UI tests.
