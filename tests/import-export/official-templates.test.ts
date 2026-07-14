import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildOfficialTemplateMapping,
  detectOfficialTemplate,
  headersMatchOfficialTemplate,
} from '../../src/lib/import-export/templates/official-template'
import { buildOfficialTemplateRows, serializeOfficialTemplate } from '../../src/lib/import-export/templates/template-builder'
import { CUSTOMER_OFFICIAL_TEMPLATES } from '../../src/lib/import-export/registry/modules/customers.official-templates'
import { ACCOUNT_OFFICIAL_TEMPLATES } from '../../src/lib/import-export/registry/modules/accounts.official-templates'
import { COST_CENTER_OFFICIAL_TEMPLATES } from '../../src/lib/import-export/registry/modules/cost-centers.official-templates'
import { autoMapColumns, applyColumnMapping } from '../../src/lib/import-export/mapping/auto-mapper'
import { CUSTOMER_FIELDS } from '../../src/lib/import-export/registry/modules/customers.fields'

describe('official template detection', () => {
  it('detects matching customer official template headers', () => {
    const template = CUSTOMER_OFFICIAL_TEMPLATES[0]
    const headers = template.columns.map((column) => column.header)
    assert.ok(headersMatchOfficialTemplate(headers, template))
    assert.equal(detectOfficialTemplate(headers, CUSTOMER_OFFICIAL_TEMPLATES)?.id, 'standard')
  })

  it('does not match generic QuickBooks-like headers to official template', () => {
    const template = CUSTOMER_OFFICIAL_TEMPLATES[0]
    const headers = ['Name', 'Email', 'Phone']
    assert.equal(headersMatchOfficialTemplate(headers, template), false)
    assert.equal(detectOfficialTemplate(headers, CUSTOMER_OFFICIAL_TEMPLATES), null)
  })

  it('detects chart of accounts official template', () => {
    const template = ACCOUNT_OFFICIAL_TEMPLATES[0]
    const headers = template.columns.map((column) => column.header)
    assert.equal(detectOfficialTemplate(headers, ACCOUNT_OFFICIAL_TEMPLATES)?.id, 'standard')
  })

  it('detects cost center class and location templates', () => {
    const classes = COST_CENTER_OFFICIAL_TEMPLATES.find((item) => item.id === 'classes')!
    const locations = COST_CENTER_OFFICIAL_TEMPLATES.find((item) => item.id === 'locations')!
    assert.equal(
      detectOfficialTemplate(['Class Full Name'], COST_CENTER_OFFICIAL_TEMPLATES)?.id,
      'classes',
    )
    assert.equal(
      detectOfficialTemplate(['Location Full Name'], COST_CENTER_OFFICIAL_TEMPLATES)?.id,
      'locations',
    )
    assert.ok(classes.columns[0].example.includes(':'))
    assert.equal(locations.columns[0].example, 'Riyadh')
  })

  it('builds mapping that skips manual mapping step', () => {
    const template = CUSTOMER_OFFICIAL_TEMPLATES[0]
    const headers = template.columns.map((column) => column.header)
    const mapping = buildOfficialTemplateMapping(headers, template)
    assert.equal(mapping['Customer Name'], 'name')
    assert.equal(mapping['VAT Number'], 'taxId')
  })

  it('falls back to generic auto-map for non-matching headers', () => {
    const headers = ['Name', 'Email', 'Phone', 'City', 'Country']
    const detected = detectOfficialTemplate(headers, CUSTOMER_OFFICIAL_TEMPLATES)
    assert.equal(detected, null)
    const genericMapping = autoMapColumns(headers, CUSTOMER_FIELDS)
    assert.ok(Object.values(genericMapping).includes('name'))
  })
})

describe('official template generation', () => {
  it('generates template with headers and one example row', () => {
    const template = ACCOUNT_OFFICIAL_TEMPLATES[0]
    const rows = buildOfficialTemplateRows(template)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]['Account No.'], '32-3201-320101')
    assert.match(rows[0]['Full Name'], /CASH AND BANK/)
  })

  it('serializes CSV and XLSX templates', () => {
    const template = CUSTOMER_OFFICIAL_TEMPLATES[0]
    const csv = serializeOfficialTemplate('csv', template)
    const xlsx = serializeOfficialTemplate('xlsx', template)
    assert.equal(csv.extension, 'csv')
    assert.equal(xlsx.extension, 'xlsx')
    assert.match(String(csv.content), /Customer Name/)
    assert.ok((xlsx.content as ArrayBuffer).byteLength > 0)
  })
})

describe('official template import path', () => {
  it('official template headers differ from generic synonym mapping completeness', () => {
    const template = CUSTOMER_OFFICIAL_TEMPLATES[0]
    const headers = template.columns.map((column) => column.header)
    const officialMapping = buildOfficialTemplateMapping(headers, template)
    const mapped = applyColumnMapping(
      [{ 'Customer Name': 'Al Rajhi Trading Establishment', Email: 'billing@alrajhi.com.sa' }],
      officialMapping,
    )
    assert.equal(mapped[0].mapped.name, 'Al Rajhi Trading Establishment')
    assert.equal(mapped[0].mapped.email, 'billing@alrajhi.com.sa')
  })
})
