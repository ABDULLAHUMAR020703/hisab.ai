# Security Test Plan — hisab.ai

**Classification:** Pre-release security assessment  
**Scope:** Authentication, authorization, data exposure, ZATCA credentials

---

## 1. Authentication

### AUTH-SEC-001 — Password storage

| Test | Method | Expected |
|------|--------|----------|
| Passwords hashed | Inspect DB `User.password` | bcrypt hash, not plaintext |
| Login timing | Wrong password vs wrong email | Similar response time (no user enumeration) |

```sql
SELECT email, password FROM User LIMIT 2;
-- password should start with $2 (bcrypt)
```

### AUTH-SEC-002 — Session security

| Test | Expected |
|------|----------|
| Cookie flags | `HttpOnly`, `SameSite=Lax` |
| Production cookie | `Secure` flag when `NODE_ENV=production` |
| Session token entropy | 64-char hex (32 bytes) |
| Expired session | Rejected after `expiresAt` |

**Manual:** DevTools → Application → Cookies → verify flags.

### AUTH-SEC-003 — Session fixation

| Test | Steps | Expected |
|------|-------|----------|
| New session on login | Note cookie before login → login | New token issued |

### AUTH-SEC-004 — Brute force

| Test | Expected |
|------|----------|
| No rate limiting currently | **FINDING:** Document risk |
| Recommendation | Add rate limit on `/api/auth/login` |

---

## 2. Authorization

### AUTHZ-SEC-001 — API requires auth

| Test | Command | Expected |
|------|---------|----------|
| No cookie | `curl /api/invoices` | 401 |
| No cookie | `curl /api/zatca/dashboard` | 401 |
| No cookie | `curl /api/users` | 401 |

### AUTHZ-SEC-002 — Role-based access

| Test | Expected |
|------|----------|
| Accountant accesses ZATCA submit | **Currently allowed** — document |
| Viewer role restrictions | **Not enforced on APIs** — document risk |
| Admin-only user management | UI only, API not role-checked |

**Recommendation:** Add role middleware for ADMIN-only routes.

### AUTHZ-SEC-003 — Page-level protection

| Test | Expected |
|------|----------|
| `/invoices` without login | Redirect to `/login` (via proxy.ts) |
| Direct API call without login | 401 |

**Gap:** Page HTML may load before API 401 — low risk for SPA.

---

## 3. Tenant Isolation

### TENANT-SEC-001 — Single-tenant model

| Test | Finding |
|------|---------|
| No `tenantId` on models | All users share one dataset |
| CompanySettings singleton | One company per database |
| Risk | Any authenticated user sees all financial data |

**For SaaS release:** Multi-tenancy required before multi-customer deployment.

### TENANT-SEC-002 — Data scoping

| Test | Expected |
|------|----------|
| User A cannot see User B's data | **N/A** — same company, all data visible |
| Cross-company leak | Deploy separate DB per customer |

---

## 4. Sensitive Data Exposure

### DATA-SEC-001 — API response leakage

| Endpoint | Must NOT return |
|----------|-----------------|
| `/api/zatca/onboarding/status` | private key, secret |
| `/api/settings` | encrypted fields |
| `/api/zatca/invoices/[id]/response` | raw credentials |

**Test:** Inspect JSON responses in Network tab.

### DATA-SEC-002 — Signed XML storage

| Test | Expected |
|------|----------|
| `signedXml` in DB | Contains cert, not private key |
| API signed-xml endpoint | Auth required |

### DATA-SEC-003 — Error messages

| Test | Expected |
|------|----------|
| 500 errors | No stack traces in production response |
| ZATCA errors | Diagnostic message, no secrets |

---

## 5. ZATCA Credential Security

### ZATCA-SEC-001 — Encryption at rest

| Test | Method | Expected |
|------|--------|----------|
| Private key encrypted | DB inspection | `privateKeyEnc` is base64 blob, not PEM |
| Secret encrypted | DB inspection | `secretEnc` encrypted |
| Production key required | Unset `ZATCA_CREDENTIAL_ENCRYPTION_KEY` in prod | App throws on encrypt |

### ZATCA-SEC-002 — Dev key warning

| Test | Finding |
|------|---------|
| Dev fallback key | `'dev-only-zatca-key-change-me'` used when env unset |
| Risk | **Critical in production** if env not set |

### ZATCA-SEC-003 — Mock mode in production

| Test | Expected |
|------|----------|
| `ZATCA_MOCK_ONBOARDING=true` in prod | **CRITICAL FINDING** — fake CSID |
| `ZATCA_MOCK_SUBMISSION=true` in prod | **CRITICAL** — fake signatures |

**Verify:**

```powershell
echo $env:ZATCA_MOCK_ONBOARDING   # must be empty
echo $env:ZATCA_MOCK_SUBMISSION   # must be empty
```

---

## 6. API Access Controls

### API-SEC-001 — Unauthenticated endpoints

| Route | Auth | Risk |
|-------|------|------|
| `POST /api/seed` | **None** | **HIGH** — anyone can seed/reset demo data |
| `POST /api/auth/login` | None | Expected |
| `POST /api/auth/logout` | Cookie | Expected |

**Recommendation:** Protect `/api/seed` with auth or disable in production.

### API-SEC-002 — HTTP methods

| Test | Expected |
|------|----------|
| OPTIONS on API | CORS handled by Next.js |
| DELETE on seed | 405 or 404 |

### API-SEC-003 — IDOR (Insecure Direct Object Reference)

| Test | Steps | Expected |
|------|-------|----------|
| Access other user's invoice | GET `/api/invoices/{id}` with valid session | Allowed (single tenant) |
| Guess invoice UUID | Random ID | 404, not 500 |

---

## 7. Input Validation

### INPUT-SEC-001 — SQL injection

| Test | Expected |
|------|----------|
| Prisma parameterized queries | No raw SQL with user input |
| Search fields | Special chars handled |

### INPUT-SEC-002 — XSS

| Test | Steps | Expected |
|------|-------|----------|
| Customer name `<script>` | Create customer with script tag | Escaped in UI |
| Invoice notes HTML | Create with HTML | Not executed |

### INPUT-SEC-003 — File upload (receipts)

| Test | Expected |
|------|----------|
| Upload .exe file | Rejected or stored without execution |
| Large file | Size limit or error |
| Path traversal in filename | Sanitized |

---

## 8. Transport & Deployment

### DEPLOY-SEC-001 — HTTPS

| Test | Expected |
|------|----------|
| Production | HTTPS only |
| Cookie Secure flag | Set in production |

### DEPLOY-SEC-002 — Environment variables

| Variable | Must not be in git |
|----------|-------------------|
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Yes |
| `DATABASE_URL` (prod) | Yes |
| `NEXTAUTH_SECRET` | Yes |

Verify `.gitignore` includes `.env*`

### DEPLOY-SEC-003 — Dependencies

```powershell
npm audit
```

Document and remediate high/critical vulnerabilities.

---

## 9. Security Test Checklist

| # | Test | Pass | Notes |
|---|------|------|-------|
| 1 | Passwords bcrypt hashed | | |
| 2 | Session HttpOnly + Secure (prod) | | |
| 3 | APIs return 401 without auth | | |
| 4 | ZATCA secrets encrypted in DB | | |
| 5 | Onboarding status leaks no secrets | | |
| 6 | Mock flags off in production | | |
| 7 | ENCRYPTION_KEY set in production | | |
| 8 | /api/seed blocked in production | | |
| 9 | npm audit no critical issues | | |
| 10 | .env not in repository | | |

---

## 10. Risk Summary

| Severity | Finding | Remediation |
|----------|---------|-------------|
| **Critical** | Mock ZATCA flags in production | Enforce unset in deploy checklist |
| **Critical** | Dev encryption key fallback | Require env in production (implemented) |
| **High** | `/api/seed` unauthenticated | Add auth or env guard |
| **High** | No role-based API authorization | Add role checks |
| **Medium** | No login rate limiting | Add middleware |
| **Medium** | Single-tenant data model | Document; separate DBs per customer |
| **Low** | Page loads before API auth | Acceptable for internal tool |
