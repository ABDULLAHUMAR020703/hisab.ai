+# QuickBooks Accounting Certification feature freeze

QuickBooks Accounting Certification is temporarily disabled for the production
release and will return in a future version after accounting reconciliation is
fully verified.

The implementation, database schema, APIs, comparison engine, report
normalization, hashing, reconciliation services, exports, UI, and tests remain
in the repository. This is a feature freeze, not a removal.

## Configuration

Certification is controlled by one server-side environment variable:

```env
ENABLE_QUICKBOOKS_CERTIFICATION=false
```

The flag defaults to disabled when it is missing. Developers and administrators
can restore the complete system locally by setting it to `true` and restarting
the application:

```env
ENABLE_QUICKBOOKS_CERTIFICATION=true
```

## Disabled behavior

- Certification links, actions, badges, status cards, and progress UI are not
  rendered.
- The certification page returns a Next.js 404.
- Certification API and export routes return HTTP 404 with
  `FEATURE_TEMPORARILY_DISABLED`.
- Direct or background calls to start a certification run fail before provider
  access, database writes, or job creation.
- QuickBooks migration ends after extraction, import, materialization,
  validation, and migration-report generation.
- Migration validation, duplicate detection, integrity validation, history,
  reports, and import verification remain enabled.

## Re-enabling

Set `ENABLE_QUICKBOOKS_CERTIFICATION=true`. No schema migration, code restoration,
or feature redevelopment is required.
