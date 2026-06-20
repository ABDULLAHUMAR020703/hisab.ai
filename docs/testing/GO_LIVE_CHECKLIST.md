# Go-Live Checklist — hisab.ai

**Target:** Production deployment with live ZATCA Fatoora integration  
**Use:** Complete every item before customer release

---

## 1. Environment Variables

| Variable | Required | Production value | Verified |
|----------|----------|------------------|----------|
| `DATABASE_URL` | Yes | `postgresql://...` | [ ] |
| `DIRECT_URL` | Yes (Prisma) | PostgreSQL direct connection | [ ] |
| `NODE_ENV` | Yes | `production` | [ ] |
| `NEXTAUTH_SECRET` | Yes | 32+ random chars | [ ] |
| `NEXTAUTH_URL` | Yes | `https://your-domain.com` | [ ] |
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Yes | 32+ random chars | [ ] |
| `ZATCA_API_BASE_URL` | Yes | `https://gw-fatoora.zatca.gov.sa` | [ ] |
| `ZATCA_MOCK_ONBOARDING` | **Must be unset** | — | [ ] |
| `ZATCA_MOCK_SUBMISSION` | **Must be unset** | — | [ ] |

```powershell
# Verify mock flags absent
if ($env:ZATCA_MOCK_ONBOARDING) { throw "MOCK ONBOARDING SET" }
if ($env:ZATCA_MOCK_SUBMISSION) { throw "MOCK SUBMISSION SET" }
```

---

## 2. Database

| Item | Action | Verified |
|------|--------|----------|
| Provider | PostgreSQL (not SQLite) | [ ] |
| Schema applied | `supabase/migrations/001_schema.sql` | [ ] |
| Backup configured | Daily `pg_dump` to secure storage | [ ] |
| Connection pooling | PgBouncer / Supabase pooler on port 6543 | [ ] |
| Prisma client | `node scripts/db/prisma-generate.mjs` with postgres URL | [ ] |
| QA verify | `npm run qa:verify` against staging DB | [ ] |

---

## 3. Authentication & Security

| Item | Verified |
|------|----------|
| Default demo passwords changed or demo users disabled | [ ] |
| `POST /api/seed` disabled or auth-protected in production | [ ] |
| HTTPS enforced | [ ] |
| Session cookie `Secure` flag active | [ ] |
| `npm audit` — no critical vulnerabilities | [ ] |
| `.env` not committed to git | [ ] |

---

## 4. Company & ZATCA Configuration

| Item | Verified |
|------|----------|
| Legal name matches Fatoora registration | [ ] |
| VAT TRN valid (15 digits, starts/ends with 3) | [ ] |
| Commercial Registration (CRN) correct | [ ] |
| Saudi National Address complete (no `0000` placeholders) | [ ] |
| `zatcaEnabled: true` in settings | [ ] |
| `zatcaEnvironment: PRODUCTION` (when going live) | [ ] |
| CSR generated on production environment | [ ] |
| Compliance CSID obtained with real OTP | [ ] |
| 6 compliance invoices passed | [ ] |
| Production CSID obtained | [ ] |

---

## 5. ZATCA Functional Validation

| Test | Result | Verified |
|------|--------|----------|
| Mock sandbox 4/4 (staging) | PASS | [ ] |
| Live compliance check 1 invoice | PASS | [ ] |
| Live STANDARD clearance | CLEARED | [ ] |
| Live SIMPLIFIED reporting | REPORTED | [ ] |
| QR validates (ZATCA SDK or portal) | PASS | [ ] |
| Audit logs recording submissions | PASS | [ ] |

---

## 6. Application Functional Smoke

| Module | Smoke test | Verified |
|--------|------------|----------|
| Login / logout | | [ ] |
| Create invoice + payment | | [ ] |
| Customer CRUD | | [ ] |
| P&L report | | [ ] |
| Balance sheet | | [ ] |
| Settings save | | [ ] |
| ZATCA monitor dashboard | | [ ] |

---

## 7. Monitoring & Audit

| Item | Verified |
|------|----------|
| ZATCA audit logs persisting (`ZatcaAuditLog`) | [ ] |
| Failed submissions visible on `/zatca` monitor | [ ] |
| Application error logging (Vercel/server logs) | [ ] |
| Uptime monitoring (e.g. UptimeRobot) | [ ] |
| Certificate expiry alert plan (manual calendar) | [ ] |

---

## 8. Deployment Validation

| Step | Command / action | Verified |
|------|------------------|----------|
| Build succeeds | `npm run build` | [ ] |
| Prisma generate (postgres) | `DATABASE_URL=postgresql://... node scripts/db/prisma-generate.mjs` | [ ] |
| Deploy to staging | | [ ] |
| Run smoke tests on staging | Manual guide Section K | [ ] |
| Deploy to production | | [ ] |
| Post-deploy health check | Login + dashboard + ZATCA status | [ ] |

---

## 9. Rollback Plan

| Scenario | Action |
|----------|--------|
| Bad deployment | Revert to previous Vercel/hosting deployment |
| Database migration failure | Restore from `pg_dump` backup |
| ZATCA submission errors | Set invoices to retry; do not delete hash chain |
| Credential compromise | Rotate `ZATCA_CREDENTIAL_ENCRYPTION_KEY` + re-onboard |

### Rollback commands

```bash
# Database restore
psql $DATABASE_URL < backup-YYYYMMDD.sql

# Git revert (if needed)
git revert HEAD
git push origin master
```

---

## 10. Documentation & Support

| Document | Location | Ready |
|----------|----------|-------|
| User manual testing guide | [MANUAL_TESTING_GUIDE.md](./MANUAL_TESTING_GUIDE.md) | [ ] |
| ZATCA release checklist | [ZATCA_RELEASE_CHECKLIST.md](../ZATCA_RELEASE_CHECKLIST.md) | [ ] |
| Production readiness | [ZATCA_PRODUCTION_READINESS.md](../ZATCA_PRODUCTION_READINESS.md) | [ ] |
| Support contact for ZATCA incidents | ZATCA failure notification portal | [ ] |

---

## 11. Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Lead | | | |
| Dev Lead | | | |
| Product Owner | | | |
| ZATCA Compliance | | | |

---

## Pre-Release Command Summary

```powershell
# 1. Reset local QA environment
npm run db:seed
npm run qa:seed

# 2. Verify integrity
npm run qa:verify

# 3. ZATCA mock E2E
npm run zatca:sandbox

# 4. Build
npm run build

# 5. Staging deploy + manual smoke (MANUAL_TESTING_GUIDE.md Section K)

# 6. Live ZATCA (ZATCA_TESTING_GUIDE.md Part 7)
```

---

## Highest-Risk Go-Live Items

1. **Mock flags left on** → fake compliance, rejected by ZATCA
2. **SQLite in production** → data loss, no concurrency
3. **Missing encryption key** → dev key used for CSID secrets
4. **Placeholder addresses** → ZATCA rejection
5. **Unauthenticated /api/seed** → data corruption
6. **No live sandbox pilot** → signature/hash mismatch undetected
