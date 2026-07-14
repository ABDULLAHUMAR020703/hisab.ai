# Disaster Recovery & Backup

## Backup strategy

| Asset | Method | Frequency | Retention |
|-------|--------|-----------|-----------|
| PostgreSQL (Supabase) | Supabase automated backups + PITR | Daily / continuous | Per plan (min 7 days) |
| Storage buckets | Supabase Storage replication | Continuous | Match DB retention |
| Application config | Git + env secrets vault | On change | Indefinite |
| ZATCA credentials | Encrypted in DB (`ZATCA_CREDENTIAL_ENCRYPTION_KEY`) | On change | 7+ years (KSA tax) |

## Backup verification

1. Monthly: restore Supabase backup to staging project.
2. Run `npm run test:production` against staging.
3. Verify sample company trial balance matches production snapshot.
4. Confirm ZATCA credential decrypt works with staging key.

## Restore procedure

1. Create new Supabase project or restore from PITR.
2. Update `NEXT_PUBLIC_SUPABASE_URL`, keys in deployment env.
3. Run pending migrations: `supabase db push` or apply SQL in order.
4. Run `node scripts/deploy/validate-env.mjs`.
5. Deploy application; run `node scripts/deploy/health-check.mjs`.
6. Smoke test: login, switch company, post test journal (staging only).

## Migration rollback validation

- Migrations are **forward-only**; rollbacks use compensating migrations.
- Before production migration: apply on staging, run full test suite.
- Keep `038_performance_and_retention.sql` additive — safe to re-run (`IF NOT EXISTS`).
- Document rollback: create `039_revert_*` only if absolutely required.

## RPO / RTO targets

| Tier | RPO | RTO |
|------|-----|-----|
| Production | 1 hour (PITR) | 4 hours |
| Staging | 24 hours | 8 hours |

## Contacts & runbook

- **DB restore:** Supabase dashboard → Database → Backups
- **App redeploy:** CI/CD or `docker build && docker run`
- **Secrets rotation:** Rotate `SUPABASE_SERVICE_ROLE_KEY`, `ZATCA_CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET` in coordinated window
