# Gitignored — Phase C migration staging

Created by `npm run migrate:export` and `npm run migrate:id-map`.

| Path | Contents |
|------|----------|
| `export/` | SQLite JSON exports + `manifest.json` |
| `migration_id_map.json` | Deterministic cuid → UUID map |

Safe to delete after a successful import and validation. Re-run export + id-map before re-import.
