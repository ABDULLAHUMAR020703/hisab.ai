# Production Deployment Checklist

## Pre-deploy

- [ ] All migrations applied through `038_performance_and_retention.sql`
- [ ] `node scripts/deploy/validate-env.mjs` passes
- [ ] `npm run test:accounting` — all green
- [ ] `npx tsc --noEmit` clean
- [ ] `ZATCA_CREDENTIAL_ENCRYPTION_KEY` set in production
- [ ] `CRON_SECRET` set for scheduled job processing
- [ ] `ENABLE_QA_SEED` unset or `false` in production
- [ ] Supabase RLS policies verified on staging

## Deploy

- [ ] Build: `npm run build`
- [ ] Deploy container or Vercel production
- [ ] `node scripts/deploy/health-check.mjs` against production URL
- [ ] Verify `/api/live`, `/api/ready`, `/api/health`

## Post-deploy smoke tests

- [ ] User login / logout
- [ ] Company switch (multi-tenant cookie)
- [ ] Create draft invoice → post to ledger
- [ ] Trial balance balances
- [ ] Workflow approval notification received
- [ ] Platform job processor (cron with `x-cron-secret`)
- [ ] ZATCA sandbox submission (if enabled)

## Security hardening (production)

- [ ] HTTPS enforced (HSTS header active)
- [ ] Supabase service role key server-only
- [ ] Platform admin routes restricted to OWNER/ADMIN
- [ ] Webhook URLs pass SSRF validation
- [ ] Document uploads validated (MIME, size, filename)
- [ ] Integration credentials not exposed in GET responses

## Monitoring

- [ ] Structured JSON logs shipping to aggregator
- [ ] Health check alerts on `/api/ready` failures
- [ ] Slow query logging enabled in Supabase
- [ ] Error rate dashboard configured

## Rollback plan

- [ ] Previous deployment artifact tagged
- [ ] Database migration rollback documented
- [ ] On-call contact assigned
