# Scripts

| Folder | Purpose | npm commands |
|--------|---------|--------------|
| `db/` | Prisma generate, migrate, SQLite sync, Supabase apply/verify/seed | `postinstall`, `build`, `supabase:*` |
| `db/migration/` | Phase C SQLite → Supabase export, import, validate | `migrate:export`, `migrate:id-map`, `migrate:import`, `migrate:validate`, `migrate:test-db` |
| `qa/` | QA seed and DB verification | `qa:seed`, `qa:verify` |
| `zatca/` | Sandbox runner, phase 7 verify, server-only hooks | `zatca:sandbox`, `zatca:verify` |

Invoke scripts via `package.json` — do not add one-off diagnostic scripts here.

See [docs/migration/014_phase_c_runbook.md](../docs/migration/014_phase_c_runbook.md) for data migration steps.
