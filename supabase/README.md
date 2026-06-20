# Supabase — hisab.ai

## Migrations (Phase A)

| File | Purpose |
|------|---------|
| `migrations/001_extensions.sql` | `pgcrypto`, `set_updated_at()` |
| `migrations/002_enums.sql` | Domain enums |
| `migrations/003_companies.sql` | Companies, settings, ZATCA tables |
| `migrations/004_auth_profiles.sql` | Profiles, preferences, invitations |
| `migrations/005_company_users.sql` | Membership + RLS |

## Seed

| File | Purpose |
|------|---------|
| `seed/001_default_company.sql` | Default NETKOM tenant |
| `seed/legacy_prisma_mirror.sql` | Legacy full Prisma mirror (reference only) |

## Apply

```bash
npm run supabase:migrate
npm run supabase:seed
npm run supabase:verify
```

See [docs/migration/SUPABASE.md](../docs/migration/SUPABASE.md).
