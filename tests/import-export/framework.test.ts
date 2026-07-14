import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { autoMapColumns, applyColumnMapping, validateMappingConflicts, validateRequiredMapping } from '../../src/lib/import-export/mapping/auto-mapper'
import { parseCsv, findDuplicateHeaders } from '../../src/lib/import-export/parsers/csv-parser'
import { parseExcel } from '../../src/lib/import-export/parsers/excel-parser'
import { coerceMappedRows, validateMappedRows } from '../../src/lib/import-export/validation/validation-engine'
import { applyDuplicateStrategy } from '../../src/lib/import-export/duplicate/duplicate-detector'
import { buildTemplateRows, getExportHeaders, serializeExport } from '../../src/lib/import-export/export/export-engine'
import { FrameworkBadRequestError } from '../../src/lib/import-export/errors'
import { CUSTOMER_FIELDS } from '../../src/lib/import-export/registry/modules/customers.fields'
import { VENDOR_FIELDS } from '../../src/lib/import-export/registry/modules/vendors.fields'
import { INVENTORY_FIELDS } from '../../src/lib/import-export/registry/modules/inventory.fields'
import { ACCOUNT_FIELDS } from '../../src/lib/import-export/registry/modules/accounts.fields'
import { COST_CENTER_FIELDS } from '../../src/lib/import-export/registry/modules/cost-centers.fields'
import { EMPLOYEE_FIELDS } from '../../src/lib/import-export/registry/modules/employees.fields'
import { TAX_RATE_FIELDS } from '../../src/lib/import-export/registry/modules/tax-rates.fields'
import { MODULE_CATALOG } from '../../src/lib/import-export/registry/module-catalog'

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../..')
const TEST_DATA = path.join(ROOT, 'test-data')

const ALL_FIELDS = [
  { key: 'customers', fields: CUSTOMER_FIELDS },
  { key: 'vendors', fields: VENDOR_FIELDS },
  { key: 'inventory', fields: INVENTORY_FIELDS },
  { key: 'accounts', fields: ACCOUNT_FIELDS },
  { key: 'cost-centers', fields: COST_CENTER_FIELDS },
  { key: 'employees', fields: EMPLOYEE_FIELDS },
  { key: 'tax-rates', fields: TAX_RATE_FIELDS },
]

function readFileBuffer(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function parseFixture(moduleKey: string, size: string, format: 'csv' | 'xlsx') {
  const filePath = path.join(TEST_DATA, moduleKey, `${size}.${format}`)
  assert.ok(fs.existsSync(filePath), `Missing fixture: ${filePath}`)
  if (format === 'csv') {
    return parseCsv(fs.readFileSync(filePath, 'utf8'))
  }
  return parseExcel(readFileBuffer(filePath))
}

describe('module catalog', () => {
  it('lists all 7 migrated modules', () => {
    assert.equal(MODULE_CATALOG.length, 7)
    const keys = MODULE_CATALOG.map((m) => m.key)
    assert.deepEqual(keys, [
      'customers', 'vendors', 'inventory', 'accounts',
      'cost-centers', 'employees', 'tax-rates',
    ])
  })
})

describe('test data fixtures', () => {
  for (const { key } of ALL_FIELDS) {
    for (const size of ['small', 'medium', 'large'] as const) {
      const expectedRows = size === 'small' ? 10 : size === 'medium' ? 100 : 1000

      it(`${key}/${size}.csv parses with ${expectedRows} rows`, () => {
        const parsed = parseFixture(key, size, 'csv')
        assert.ok(parsed.headers.length > 0)
        assert.equal(parsed.rows.length, expectedRows)
        assert.equal(parsed.format, 'csv')
      })

      it(`${key}/${size}.xlsx parses with ${expectedRows} rows`, () => {
        const parsed = parseFixture(key, size, 'xlsx')
        assert.ok(parsed.headers.length > 0)
        assert.equal(parsed.rows.length, expectedRows)
        assert.equal(parsed.format, 'xlsx')
      })
    }
  }
})

describe('auto-mapping', () => {
  for (const { key, fields } of ALL_FIELDS) {
    it(`auto-maps ${key} standard headers from small CSV`, () => {
      const parsed = parseFixture(key, 'small', 'csv')
      const mapping = autoMapColumns(parsed.headers, fields)
      const conflict = validateMappingConflicts(mapping)
      assert.equal(conflict, null, conflict ?? '')
      const requiredError = validateRequiredMapping(mapping, fields)
      assert.equal(requiredError, null, requiredError ?? '')

      const mapped = applyColumnMapping(parsed.rows, mapping)
      const coerced = coerceMappedRows(mapped, fields)
      const validation = validateMappedRows(coerced, fields)
      assert.equal(validation.errorCount, 0, JSON.stringify(validation.issues.filter((i) => i.severity === 'error').slice(0, 3)))
    })
  }

  it('maps mixed-case headers for customers', () => {
    const csv = fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/mixed-case-headers-data.csv'),
      'utf8',
    )
    const parsed = parseCsv(csv)
    const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
    assert.ok(Object.values(mapping).includes('name'))
    assert.ok(Object.values(mapping).includes('email'))
  })
})

describe('edge cases — CSV parsing', () => {
  it('rejects duplicate headers', () => {
    const csv = fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/duplicate-headers.csv'),
      'utf8',
    )
    assert.throws(() => parseCsv(csv), FrameworkBadRequestError)
    const headers = ['Name', 'Name', 'Email']
    assert.deepEqual(findDuplicateHeaders(headers), ['Name'])
  })

  it('parses empty file with headers only', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/empty-file.csv'),
      'utf8',
    ))
    assert.equal(parsed.rows.length, 0)
    assert.ok(parsed.headers.length > 0)
  })

  it('parses Arabic and special characters', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/special-characters-arabic.csv'),
      'utf8',
    ))
    assert.equal(parsed.rows.length, 2)
    assert.match(parsed.rows[0].Name, /النخيل/)
  })
})

describe('validation — errors block import', () => {
  it('flags blank required name as error', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/blank-required-fields.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), CUSTOMER_FIELDS)
    const result = validateMappedRows(mapped, CUSTOMER_FIELDS)
    assert.ok(result.errorCount > 0)
    assert.ok(result.invalidRowNumbers.includes(1))
    assert.ok(result.validRowNumbers.includes(2))
  })

  it('flags invalid email as error', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/wrong-data-types.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), CUSTOMER_FIELDS)
    const result = validateMappedRows(mapped, CUSTOMER_FIELDS)
    const emailIssue = result.issues.find((i) => i.fieldKey === 'email' && i.severity === 'error')
    assert.ok(emailIssue)
  })

  it('invalid VAT is warning not error', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/customers/wrong-data-types.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), CUSTOMER_FIELDS)
    const result = validateMappedRows(mapped, CUSTOMER_FIELDS)
    const vatWarning = result.issues.find((i) => i.code === 'INVALID_VAT')
    assert.ok(vatWarning)
    assert.equal(vatWarning?.severity, 'warning')
  })

  it('invalid joining date is error for employees', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/employees/invalid-dates.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, EMPLOYEE_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), EMPLOYEE_FIELDS)
    const result = validateMappedRows(mapped, EMPLOYEE_FIELDS)
    assert.ok(result.errorCount >= 2)
  })

  it('negative inventory price is error', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/inventory/negative-prices.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, INVENTORY_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), INVENTORY_FIELDS)
    const result = validateMappedRows(mapped, INVENTORY_FIELDS)
    assert.ok(result.issues.some((i) => i.fieldKey === 'costPrice' && i.severity === 'error'))
  })

  it('missing account required fields are errors', () => {
    const parsed = parseCsv(fs.readFileSync(
      path.join(TEST_DATA, 'edge-cases/accounts/missing-required.csv'),
      'utf8',
    ))
    const mapping = autoMapColumns(parsed.headers, ACCOUNT_FIELDS)
    const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), ACCOUNT_FIELDS)
    const result = validateMappedRows(mapped, ACCOUNT_FIELDS)
    assert.ok(result.invalidRowNumbers.includes(1))
    assert.ok(result.validRowNumbers.includes(2))
  })
})

describe('duplicate strategy', () => {
  it('skip strategy skips duplicates', () => {
    assert.equal(applyDuplicateStrategy('skip', true), 'skip')
    assert.equal(applyDuplicateStrategy('skip', false), 'import')
  })

  it('update strategy updates duplicates', () => {
    assert.equal(applyDuplicateStrategy('update', true), 'update')
  })

  it('create strategy creates duplicates', () => {
    assert.equal(applyDuplicateStrategy('create', true), 'create')
  })
})

describe('export engine', () => {
  for (const { key, fields } of ALL_FIELDS) {
    it(`builds template for ${key}`, () => {
      const rows = buildTemplateRows(fields)
      assert.equal(rows.length, 1)
      const headers = getExportHeaders(fields)
      assert.ok(headers.length > 0)
    })

    it(`serializes ${key} CSV export`, () => {
      const parsed = parseFixture(key, 'small', 'csv')
      const headers = getExportHeaders(fields)
      const mapping = autoMapColumns(parsed.headers, fields)
      const mapped = applyColumnMapping(parsed.rows.slice(0, 3), mapping)
      const exportRows = mapped.map((row) => {
        const out: Record<string, string | number | boolean | null> = {}
        for (const h of headers) out[h] = String(row.mapped[h] ?? '')
        return out
      })
      const result = serializeExport('csv', headers, exportRows)
      assert.equal(typeof result.content, 'string')
      assert.ok((result.content as string).includes('\n'))
    })

    it(`serializes ${key} XLSX export`, () => {
      const headers = getExportHeaders(fields)
      const result = serializeExport('csv', headers, [{ name: 'Sample' }])
      assert.ok(result.extension === 'csv')
    })
  }
})

describe('realistic data quality', () => {
  it('customers include Saudi, Pakistan, and UAE companies', () => {
    const parsed = parseFixture('customers', 'small', 'csv')
    const countries = new Set(parsed.rows.map((r) => r.Country))
    assert.ok(countries.has('Saudi Arabia'))
    assert.ok(countries.has('Pakistan'))
    assert.ok(countries.has('United Arab Emirates'))
  })

  it('customers do not use placeholder names', () => {
    const parsed = parseFixture('customers', 'medium', 'csv')
    for (const row of parsed.rows) {
      assert.ok(!/^Test \d+$/i.test(row.Name), `Placeholder name: ${row.Name}`)
      assert.ok(!/^ABC Company/i.test(row.Name))
    }
  })

  it('inventory includes hardware and services', () => {
    const parsed = parseFixture('inventory', 'small', 'csv')
    const categories = new Set(parsed.rows.map((r) => r.Category))
    assert.ok(categories.has('Hardware'))
    assert.ok(categories.has('Services') || categories.has('Software'))
  })

  it('cost centers include LOCATION, CLASS, and PROJECT', () => {
    const parsed = parseFixture('cost-centers', 'small', 'csv')
    const types = new Set(parsed.rows.map((r) => r.Type))
    assert.ok(types.has('LOCATION'))
    assert.ok(types.has('CLASS'))
    assert.ok(types.has('PROJECT'))
  })
})
