/**
 * Read-only schema/count audit for the accounting data reset plan.
 * Uses PostgREST OpenAPI + Prefer:count=exact. Does not delete anything.
 * Run: node -r dotenv/config scripts/db/audit-operational-reset.mjs
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const headers = { apikey: key, Authorization: `Bearer ${key}` }

const PRESERVE = new Set([
  'companies', 'company_settings', 'company_zatca_settings', 'company_subscriptions',
  'company_users', 'profiles', 'user_preferences', 'invitations',
  'zatca_credentials', 'zatca_onboarding_requests',
  'accounting_integration_providers', 'accounting_integration_connections',
  'accounting_integration_oauth_states',
  'company_currencies', 'currency_settings', 'tax_rates', 'tax_groups', 'tax_group_rates',
  'tax_exemptions', 'regional_tax_rules', 'tax_agencies',
  'document_sequences', 'numbering_series', 'sequences', 'posting_sequences',
  'feature_flags', 'feature_flag_overrides', 'locale_settings', 'translations',
  'notification_preferences', 'data_retention_policies', 'document_retention_policies',
  'accounting_sync_settings',
  'custom_field_definitions',
  'payment_terms', 'payment_methods', 'units_of_measure', 'warehouses', 'departments',
  'expense_categories', 'customer_types',
  'document_categories', 'document_tags',
  'workflow_templates', 'workflow_template_steps', 'workflow_template_step_approvers', 'workflow_bindings',
  'automation_rules', 'webhook_endpoints', 'api_keys', 'integration_connectors', 'integration_connections',
  'report_definitions', 'report_templates', 'report_permissions',
])

async function listTablesFromOpenApi() {
  const res = await fetch(`${url}/rest/v1/`, { headers: { ...headers, Accept: 'application/openapi+json' } })
  if (!res.ok) throw new Error(`OpenAPI ${res.status}`)
  const spec = await res.json()
  const paths = Object.keys(spec.paths || {})
  return paths
    .filter((p) => p.startsWith('/') && !p.slice(1).includes('/'))
    .map((p) => p.slice(1))
    .filter((name) => name && !name.includes('{'))
    .sort()
}

async function countExact(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  if (res.status === 404 || res.status === 406) return { error: `HTTP ${res.status}` }
  const range = res.headers.get('content-range') // e.g. */123
  const match = range && /\*|(\d+)$/.exec(range)
  // content-range is like 0-0/123 or */0
  const total = range?.includes('/') ? Number(range.split('/')[1]) : NaN
  if (!res.ok && Number.isNaN(total)) {
    const body = await res.text()
    return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  return { count: Number.isFinite(total) ? total : 0 }
}

async function sampleCompanyCounts(tables, companyId) {
  const out = {}
  for (const table of tables) {
    const res = await fetch(`${url}/rest/v1/${table}?company_id=eq.${companyId}&select=*&limit=0`, {
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    })
    const range = res.headers.get('content-range')
    const total = range?.includes('/') ? Number(range.split('/')[1]) : null
    if (res.ok || Number.isFinite(total)) out[table] = total
  }
  return out
}

const tables = await listTablesFromOpenApi()
const counts = {}
const errors = {}
for (const table of tables) {
  const result = await countExact(table)
  if ('error' in result) errors[table] = result.error
  else counts[table] = result.count
}

const withData = Object.entries(counts)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1])

const preserveWithData = withData.filter(([t]) => PRESERVE.has(t))
const deleteCandidates = withData.filter(([t]) => !PRESERVE.has(t))
const emptyPreserve = [...PRESERVE].filter((t) => counts[t] === 0 || counts[t] === undefined)

const companies = await (await fetch(`${url}/rest/v1/companies?select=id,name,created_at&order=created_at`, { headers })).json()
const connections = await (await fetch(`${url}/rest/v1/accounting_integration_connections?select=id,tenant_id,status,realm_id,provider_id&order=updated_at.desc`, { headers })).json()
const companyUsers = await (await fetch(`${url}/rest/v1/company_users?select=company_id,user_id,role&company_id=eq.05585a44-672d-4bab-aa40-6dfe022c19a0`, { headers })).json()

const targetId = '05585a44-672d-4bab-aa40-6dfe022c19a0'
const targetDeleteTables = deleteCandidates.map(([t]) => t)
const targetCounts = await sampleCompanyCounts(targetDeleteTables.slice(0, 80), targetId)

const report = {
  at: new Date().toISOString(),
  tableCount: tables.length,
  companies,
  targetCompanyUsers: companyUsers,
  connections: Array.isArray(connections)
    ? connections.map((c) => ({ id: c.id, tenant_id: c.tenant_id, status: c.status, realm_id: c.realm_id }))
    : connections,
  preserveWithData,
  deleteCandidates,
  emptyOrMissingPreserve: emptyPreserve,
  countErrors: errors,
  targetCompanyDeleteCounts: Object.entries(targetCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]),
  allTables: tables,
}

const { mkdir, writeFile } = await import('node:fs/promises')
await mkdir('test-data/benchmarks', { recursive: true })
await writeFile('test-data/benchmarks/db-reset-audit.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  tables: tables.length,
  companies: companies.length,
  connections: Array.isArray(connections) ? connections.length : 'error',
  preserveWithData: preserveWithData.length,
  deleteCandidateTablesWithRows: deleteCandidates.length,
  topDeletes: deleteCandidates.slice(0, 40),
  targetNonZero: Object.entries(targetCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 30),
  output: 'test-data/benchmarks/db-reset-audit.json',
}, null, 2))
