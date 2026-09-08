/**
 * QuickBooks reverse-charge tax mapping (Issue 1).
 *
 * QuickBooks encodes reverse charge as a code pair — a positive rate that adds
 * output VAT and a negative "N-" counterpart that reverses it:
 *   TaxRate 3  SPRC-15    RateValue  15   SpecialTaxType REVERSE_CHARGE
 *   TaxRate 4  N-SPRC-15  RateValue -15   SpecialTaxType REVERSE_CHARGE
 * hisab.ai's `tax_rates` requires `rate` in [0, 100] (tax_rates_rate_nonneg_chk
 * / tax_rates_rate_pct_chk) and carries the mechanism on `is_reverse_charge`.
 * The mapper must therefore use |RateValue| as the rate and set the flag from
 * SpecialTaxType — without which N-SPRC-15 raised PostgreSQL 23514.
 *
 * Run: npx tsx --test tests/integrations/quickbooks-tax-reverse-charge.test.ts
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://tax-reverse-charge-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-test'

const { QuickBooksImportAdapter, filterResourceRows } = requireModule(
  '../../src/lib/import-export/sources/quickbooks.adapter',
) as typeof import('../../src/lib/import-export/sources/quickbooks.adapter')
const { taxRatesModule } = requireModule(
  '../../src/lib/import-export/registry/modules/tax-rates.module',
) as typeof import('../../src/lib/import-export/registry/modules/tax-rates.module')

const REALM = '9130356995984366'
const normalize = (raw: unknown[]) =>
  new QuickBooksImportAdapter().normalizeRecords('tax-codes', filterResourceRows('tax-codes', raw), REALM)

// The 16 real NETKOM tax codes from snapshot 237582b7 tax-codes/page-000001.json.
const NETKOM_TAX_CODES = [
  { Id: '5', Name: 'EP', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true },
  { Id: '6', Name: 'ES', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true },
  { Id: '4', Name: 'N-SPRC-15', RateValue: -15, SpecialTaxType: 'REVERSE_CHARGE', Active: true },
  { Id: '12', Name: 'NOTAXP', RateValue: 0, SpecialTaxType: 'NONE', Active: true },
  { Id: '13', Name: 'NOTAXS', RateValue: 0, SpecialTaxType: 'NONE', Active: true },
  { Id: '2', Name: 'SI', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '9', Name: 'SP-15', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '3', Name: 'SPRC-15', RateValue: 15, SpecialTaxType: 'REVERSE_CHARGE', Active: true },
  { Id: '10', Name: 'SS-15', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '15', Name: 'VAT (Purchases)', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '14', Name: 'VAT (Sales)', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '17', Name: 'ZATCA (Purchases)', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '16', Name: 'ZATCA (Sales)', RateValue: 15, SpecialTaxType: 'NONE', Active: true },
  { Id: '11', Name: 'ZE', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true },
  { Id: '7', Name: 'ZP', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true },
  { Id: '8', Name: 'ZS', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true },
]

test('N-SPRC-15 (RateValue -15, REVERSE_CHARGE) → rate "15", isReverseCharge "true"', () => {
  const [row] = normalize([{ Id: '4', Name: 'N-SPRC-15', RateValue: -15, SpecialTaxType: 'REVERSE_CHARGE', Active: true }])
  assert.equal(row.rate, '15')
  assert.equal(row.isReverseCharge, 'true')
  assert.equal(Number(row.rate) >= 0, true, 'rate must be non-negative so tax_rates_rate_nonneg_chk (23514) is not hit')
})

test('SPRC-15 (RateValue +15, REVERSE_CHARGE) → rate "15", isReverseCharge "true"', () => {
  const [row] = normalize([{ Id: '3', Name: 'SPRC-15', RateValue: 15, SpecialTaxType: 'REVERSE_CHARGE', Active: true }])
  assert.equal(row.rate, '15')
  assert.equal(row.isReverseCharge, 'true')
})

test('SI (RateValue +15, NONE) → rate "15", isReverseCharge "false"', () => {
  const [row] = normalize([{ Id: '2', Name: 'SI', RateValue: 15, SpecialTaxType: 'NONE', Active: true }])
  assert.equal(row.rate, '15')
  assert.equal(row.isReverseCharge, 'false')
})

test('ZERO_RATE code (RateValue 0) → rate "0", no crash, isReverseCharge "false"', () => {
  const [row] = normalize([{ Id: '5', Name: 'EP', RateValue: 0, SpecialTaxType: 'ZERO_RATE', Active: true }])
  assert.equal(row.rate, '0')
  assert.equal(row.isReverseCharge, 'false')
})

test('missing / non-numeric RateValue degrades to "0" rather than NaN', () => {
  assert.equal(normalize([{ Id: 'x', Name: 'no-rate', SpecialTaxType: 'NONE', Active: true }])[0].rate, '0')
  assert.equal(normalize([{ Id: 'y', Name: 'junk', RateValue: 'abc', SpecialTaxType: 'NONE', Active: true }])[0].rate, '0')
})

test('every NETKOM tax code maps to a non-negative rate; only the two REVERSE_CHARGE codes are flagged', () => {
  const normalized = normalize(NETKOM_TAX_CODES)
  assert.equal(normalized.length, 16)
  for (const row of normalized) {
    assert.equal(Number.isFinite(Number(row.rate)) && Number(row.rate) >= 0, true, `${row.name} rate=${row.rate}`)
  }
  const flagged = normalized.filter((row) => row.isReverseCharge === 'true').map((row) => row.name).sort()
  assert.deepEqual(flagged, ['N-SPRC-15', 'SPRC-15'])
  // The 10 plain NONE codes keep their face rate and stay unflagged.
  const si = normalized.find((row) => row.name === 'SI')!
  assert.equal(si.rate, '15')
  assert.equal(si.isReverseCharge, 'false')
})

test('tax-rates module parser propagates isReverseCharge from the mapped row', () => {
  const parse = taxRatesModule.parseImportRow!
  assert.equal((parse({ name: 'N-SPRC-15', rate: '15', isReverseCharge: 'true' }) as Record<string, unknown>).isReverseCharge, true)
  assert.equal((parse({ name: 'SI', rate: '15', isReverseCharge: 'false' }) as Record<string, unknown>).isReverseCharge, false)
  // A CSV / official-template row without the key must not force the column.
  assert.equal('isReverseCharge' in (parse({ name: 'CSV Rate', rate: '5' }) as Record<string, unknown>), false)
})

test('tax-rates repository create/update send is_reverse_charge to Postgres', async () => {
  const realFetch = globalThis.fetch
  const bodies: Array<{ method: string; table: string; body: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.hostname.endsWith('.supabase.co')) return realFetch(input, init)
    const method = String(init?.method ?? 'GET').toUpperCase()
    const table = url.pathname.replace('/rest/v1/', '')
    const body = init?.body ? JSON.parse(String(init.body)) : null
    bodies.push({ method, table, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return json([{ id: 'tr-1', name: 'x', rate: 15, type: 'VAT', is_default: false, is_reverse_charge: true, is_active: true, created_at: '2026-01-01T00:00:00Z' }])
    if (method === 'POST') return json({ id: 'tr-1', name: 'x', rate: 15, type: 'VAT', is_default: false, is_reverse_charge: true, is_active: true, created_at: '2026-01-01T00:00:00Z' })
    return json({ id: 'tr-1', name: 'x', rate: 15, type: 'VAT', is_default: false, is_reverse_charge: false, is_active: true, created_at: '2026-01-01T00:00:00Z' })
  }) as typeof globalThis.fetch
  try {
    const { supabaseTaxRateRepository } = requireModule('../../src/lib/db/repositories/tax-rate.repository.supabase') as typeof import('../../src/lib/db/repositories/tax-rate.repository.supabase')
    const { withCompanyContext } = requireModule('../../src/lib/tenant') as typeof import('../../src/lib/tenant')
    const CO = '00000000-0000-4000-8000-000000000001'

    await withCompanyContext(CO, () => supabaseTaxRateRepository.create({ name: 'N-SPRC-15', rate: 15, isReverseCharge: true }))
    const insert = bodies.find((b) => b.method === 'POST' && b.table === 'tax_rates')
    assert.ok(insert, 'a tax_rates insert was issued')
    assert.equal((insert!.body as Record<string, unknown>).is_reverse_charge, true)
    assert.equal((insert!.body as Record<string, unknown>).rate, 15)

    bodies.length = 0
    await withCompanyContext(CO, () => supabaseTaxRateRepository.update('tr-1', { rate: 15, isReverseCharge: true }))
    const patch = bodies.find((b) => b.method === 'PATCH' && b.table === 'tax_rates')
    assert.ok(patch, 'a tax_rates patch was issued')
    assert.equal((patch!.body as Record<string, unknown>).is_reverse_charge, true)

    // An update that does not mention the flag must not touch the column.
    bodies.length = 0
    await withCompanyContext(CO, () => supabaseTaxRateRepository.update('tr-1', { name: 'renamed' }))
    const patch2 = bodies.find((b) => b.method === 'PATCH' && b.table === 'tax_rates')
    assert.equal('is_reverse_charge' in (patch2!.body as Record<string, unknown>), false)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('snapshot-source normalization of N-SPRC-15 no longer yields a negative rate (the 23514 cause)', () => {
  // snapshot-source.ts runs exactly this transform on the stored raw page.
  const fromSnapshot = new QuickBooksImportAdapter().normalizeRecords(
    'tax-codes',
    filterResourceRows('tax-codes', [{ Id: '4', Name: 'N-SPRC-15', RateValue: -15, SpecialTaxType: 'REVERSE_CHARGE', Active: true }]),
    REALM,
  )
  assert.equal(fromSnapshot[0].rate, '15')
  assert.equal(fromSnapshot[0].isReverseCharge, 'true')
  const parsed = taxRatesModule.parseImportRow!(fromSnapshot[0]) as Record<string, unknown>
  assert.equal(parsed.rate, 15)
  assert.equal((parsed.rate as number) >= 0, true)
  assert.equal(parsed.isReverseCharge, true)
})
