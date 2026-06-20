# ZATCA Release Checklist

**Project:** hisab.ai  
**Version:** Phase 7  
**Last updated:** 2026-06-10

Use this checklist when deploying ZATCA e-invoicing to staging or production.

---

## 1. Environment Variables

| Variable | Staging (Simulation) | Production | Required |
|----------|---------------------|------------|----------|
| `DATABASE_URL` | PostgreSQL URL | PostgreSQL URL | Yes |
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Strong random 32+ bytes | Strong random 32+ bytes | **Yes** |
| `ZATCA_API_BASE_URL` | `https://gw-fatoora.zatca.gov.sa` | Same | No (default OK) |
| `ZATCA_MOCK_ONBOARDING` | `false` or unset | **Must be unset** | No |
| `ZATCA_MOCK_SUBMISSION` | `false` or unset | **Must be unset** | No |
| `NODE_ENV` | `production` | `production` | Yes |

**Pre-deploy check:**

```bash
# Confirm mock flags are not set
echo $ZATCA_MOCK_ONBOARDING   # should be empty
echo $ZATCA_MOCK_SUBMISSION   # should be empty
```

---

## 2. Credential Setup

- [ ] Company VAT TRN (15 digits) in Settings
- [ ] Commercial Registration (CRN) in Settings
- [ ] Full Saudi National Address (building, street, district, city, postal code)
- [ ] `zatcaEnabled = true`
- [ ] `zatcaEnvironment` set correctly (SANDBOX for staging, PRODUCTION for live)
- [ ] CSR generated via `POST /api/zatca/onboarding/csr`
- [ ] Compliance CSID issued with Fatoora OTP
- [ ] 6 compliance invoices passed via `POST .../compliance-check`
- [ ] Production CSID issued via `POST /api/zatca/onboarding/production`
- [ ] Verify `GET /api/zatca/onboarding/status` shows `PRODUCTION_ISSUED`

---

## 3. Database Backup Procedures

**Before deployment:**

```bash
# SQLite (dev only)
cp prisma/dev.db prisma/dev.db.backup-$(date +%Y%m%d)

# PostgreSQL (production)
pg_dump $DATABASE_URL > backup-zatca-$(date +%Y%m%d).sql
```

**Tables to include in backup policy:**

| Table | Contains |
|-------|----------|
| `ZatcaCredential` | Encrypted keys, certificates, CSIDs |
| `ZatcaAuditLog` | Compliance audit trail |
| `Invoice` | ZATCA status, signed XML, hashes |
| `CompanySettings` | ZATCA configuration |

**Restore test:** Verify credential decryption works after restore with same `ZATCA_CREDENTIAL_ENCRYPTION_KEY`.

---

## 4. Migration Steps

```bash
# 1. Backup database (see above)

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm ci

# 4. Apply migrations
npx prisma migrate deploy

# 5. Generate Prisma client
npx prisma generate

# 6. Build application
npm run build
```

**Migrations required for ZATCA:**

- `20250610120000_zatca_phase2_day1` — base ZATCA fields
- `20250610160000_zatca_phase2_day4` — credentials
- `20250610180000_zatca_phase2_day5` — submission fields
- `20250610200000_zatca_phase2_day6` — audit log, sandbox tests

---

## 5. Deployment Steps

1. Set environment variables in hosting platform (Vercel/Railway/etc.)
2. Run `npx prisma migrate deploy` against production database
3. Deploy application build
4. Smoke test: login → Settings → ZATCA status loads
5. Smoke test: `/zatca` dashboard loads
6. Submit pilot simplified invoice → verify REPORTED
7. Submit pilot standard invoice → verify CLEARED
8. Review `ZatcaAuditLog` for errors

**Health checks:**

| Endpoint | Expected |
|----------|----------|
| `GET /api/zatca/onboarding/status` | 200, valid status |
| `GET /api/zatca/dashboard` | 200, stats object |
| `GET /api/zatca/invoices/[id]/compliance` | 200, `compliance.valid: true` |

---

## 6. Rollback Steps

### Application rollback

```bash
# Revert to previous deployment tag/commit
git checkout <previous-release-tag>
npm ci && npm run build
# Redeploy previous build via hosting platform
```

### Database rollback

```bash
# Restore from backup — ONLY if migration caused issues
psql $DATABASE_URL < backup-zatca-YYYYMMDD.sql
```

**Warning:** Rolling back migrations that added ZATCA columns may break the app. Prefer forward-fix unless catastrophic.

### Credential rollback

- ZATCA CSIDs cannot be "rolled back" — revoke via Fatoora portal if compromised
- Re-onboard: generate new CSR → new OTP → new compliance → new production CSID

### Disable ZATCA quickly

1. Set `zatcaEnabled = false` in Company Settings (UI)
2. Or block `POST /api/zatca/invoices/*/submit` at reverse proxy (emergency)

---

## 7. Post-Release Monitoring

- [ ] Monitor `/zatca` dashboard for FAILED count
- [ ] Review `ZatcaAuditLog` daily for first week
- [ ] Alert on `zatcaFailureCode` = `ZATCA_API_FAILURE` or `ZATCA_TIMEOUT`
- [ ] Track certificate expiry (manual until GAP-014 implemented)

---

## 8. Sign-off

| Check | Owner | Date | ✓ |
|-------|-------|------|---|
| Env vars verified | | | |
| Migrations applied | | | |
| Backup confirmed | | | |
| Pilot submission CLEARED/REPORTED | | | |
| Mock flags disabled | | | |
| Rollback procedure documented | | | |

---

## Related

- [ZATCA_TESTING_GUIDE.md](../testing/ZATCA_TESTING_GUIDE.md)
- [ZATCA_COMPLIANCE_GAP_REPORT.md](./ZATCA_COMPLIANCE_GAP_REPORT.md)
- [ZATCA_PRODUCTION_READINESS.md](./ZATCA_PRODUCTION_READINESS.md)
