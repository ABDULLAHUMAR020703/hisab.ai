# ERP Platform Services

Migration `037_platform_services.sql` adds reusable infrastructure that all ERP modules share. **Existing APIs, accounting behavior, and `/api/documents` remain unchanged.**

## Services overview

| Service | Library | API |
|---------|---------|-----|
| Document Management | `src/lib/platform/documents/` | `/api/platform/documents` + legacy `/api/documents` |
| Notification Center | `src/lib/platform/notifications/` | `/api/platform/notifications` |
| Background Jobs | `src/lib/platform/jobs/` | `/api/platform/jobs` |
| Automation Engine | `src/lib/platform/automation/` | `/api/platform/automation` |
| Webhooks | `src/lib/platform/webhooks/` | `/api/platform/webhooks` |
| API Management | `src/lib/platform/api-keys/` | `/api/platform/api-keys` |
| Integrations | `src/lib/platform/integrations/` | `/api/platform/integrations` |
| Feature Flags | `src/lib/platform/feature-flags/` | `/api/platform/feature-flags` |
| Localization | `src/lib/platform/localization/` | `/api/platform/localization` |
| Numbering Engine | `src/lib/platform/numbering/` | `/api/platform/numbering` + legacy `getNextSequence()` |
| Global Search | `src/lib/platform/search/` | `/api/platform/search` |

## Document management

Extends existing `documents` table (031) with:
- **Versioning** — `document_versions`
- **Categories** — `document_categories`
- **Tags** — `document_tags` + assignments
- **OCR metadata** — `document_ocr_metadata`
- **Comments** — `document_comments`
- **Relationships** — `document_relationships`
- **Archive** — `status` column (ACTIVE/ARCHIVED/DELETED)
- **Retention** — `document_retention_policies` + `applyRetentionPolicies()`

Legacy upload at `/api/documents` unchanged. Enhanced features via `/api/platform/documents`.

## Notification center

Unified `platform_notifications` with channels: IN_APP, EMAIL, SMS, PUSH.

- Preferences per user/category/channel
- Delivery log for audit
- Workflow notifications mirrored into platform center (additive bridge in `workflow/notifications.ts`)
- Header bell wired to `/api/platform/notifications`

## Background job system

`job_queue` with:
- Scheduled and delayed jobs (`scheduled_at`)
- Retry with exponential backoff
- Dead-letter queue (`dead_letter_queue`)
- Progress tracking (`progress`, `progress_message`)
- Job history (`job_history`)
- Cron rescheduling (`@daily`, `@hourly`, custom expression placeholder)

Built-in handlers: `EMAIL_SEND`, `WORKFLOW_REMINDER`, `REPORT_SCHEDULE`, `EXCHANGE_RATE_SYNC`, `INVENTORY_RECALC`, `WEBHOOK_RETRY`, `AUTOMATION_RUN`

Process jobs: `POST /api/platform/jobs`

## Automation engine

Database-driven rules in `automation_rules`:
```
Event → Conditions (JSON) → Actions (JSON array)
```

Action types: `NOTIFY`, `WEBHOOK`, `ENQUEUE_JOB`, `CREATE_JOURNAL`, `GENERATE_PDF`, `SEND_EMAIL`

No hardcoded automations — all rules stored per company.

Emit events: `POST /api/platform/automation` with `{ action: "emit", eventType, ... }`

## Webhook framework

- Outgoing webhooks with HMAC signing (`X-Hisab-Signature`)
- Incoming verification via `verifyIncomingWebhook()`
- Delivery log with retry scheduling
- Replay via dead-letter / `replayWebhookDelivery()`

## API management

- API keys with scopes and rate limiting (in-memory bucket per key)
- Usage logging (`api_usage_logs`)
- OAuth-ready: keys use `hsk_` prefix, scopes array, expiration

## Integration framework

Connector catalog (`integration_connectors`): QuickBooks, Xero, SAP, Stripe, PayPal, Twilio, Resend, Google, Microsoft, REST, GraphQL.

Per-company connections in `integration_connections` with encrypted credentials JSON.

## Feature flags

`feature_flags` + `feature_flag_overrides` at company/branch/user level.

Gradual rollout via `rollout_percent`. Check: `isFeatureEnabled(flagKey, context)`.

## Localization

`locale_settings` per company + `translations` table.

Helpers: `formatDate`, `formatNumber`, `formatCurrency`, `getTranslation`.

## Numbering engine

`numbering_series` with prefix, suffix, padding, fiscal year, branch.

`getNextNumber(seriesKey)` falls back to legacy `getNextSequence()` when no series configured — **fully backward compatible**.

## Global search

`globalSearch()` across customers, vendors, invoices, bills, products, journal entries, documents, employees, accounts.

Recent searches stored in `search_recent`.

## UI

| Page | Path |
|------|------|
| Platform hub | `/platform` |
| Notification center | `/notifications` |
| Global search | `/platform/search` |
| Header bell | Live unread count + preview |

## Backward compatibility

| Component | Status |
|-----------|--------|
| `/api/documents` | Unchanged |
| `getNextSequence()` | Unchanged — numbering engine falls back |
| `workflow_notifications` | Preserved — mirrored to platform center |
| Accounting engine | Not modified |
| All existing report/workflow APIs | Not modified |

## Tests

`tests/platform/services.test.ts` — automation conditions, webhooks, API keys, localization, aging.

Run: `npm run test:accounting`

## Setup

1. Apply migration `037_platform_services.sql`.
2. Open `/platform` for service hub.
3. Configure numbering series, automations, webhooks, and integrations per company.
4. Process background jobs via `POST /api/platform/jobs` (cron hook or manual).
