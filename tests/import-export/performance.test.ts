import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { autoMapColumns, applyColumnMapping } from '../../src/lib/import-export/mapping/auto-mapper'
import { parseCsv } from '../../src/lib/import-export/parsers/csv-parser'
import { parseExcel } from '../../src/lib/import-export/parsers/excel-parser'
import { coerceMappedRows, validateMappedRows } from '../../src/lib/import-export/validation/validation-engine'
import { serializeExport, getExportHeaders } from '../../src/lib/import-export/export/export-engine'
import { CUSTOMER_FIELDS } from '../../src/lib/import-export/registry/modules/customers.fields'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TEST_DATA = path.join(ROOT, 'test-data')

interface BenchResult {
  operation: string
  rows: number
  format: string
  ms: number
}

const results: BenchResult[] = []

function bench(operation: string, rows: number, format: string, fn: () => void) {
  // warmup
  fn()
  const start = performance.now()
  fn()
  const ms = Math.round((performance.now() - start) * 100) / 100
  results.push({ operation, rows, format, ms })
}

function readBuffer(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('import/export performance benchmarks', () => {
  const sizes = [
    { name: 'small', rows: 10 },
    { name: 'medium', rows: 100 },
    { name: 'large', rows: 1000 },
  ] as const

  for (const size of sizes) {
    it(`CSV parse — customers/${size.name} (${size.rows} rows)`, () => {
      const filePath = path.join(TEST_DATA, 'customers', `${size.name}.csv`)
      const text = fs.readFileSync(filePath, 'utf8')
      bench('csv-parse', size.rows, 'csv', () => {
        const parsed = parseCsv(text)
        assert.equal(parsed.rows.length, size.rows)
      })
    })

    it(`Excel parse — customers/${size.name} (${size.rows} rows)`, () => {
      const filePath = path.join(TEST_DATA, 'customers', `${size.name}.xlsx`)
      const buffer = readBuffer(filePath)
      bench('excel-parse', size.rows, 'xlsx', () => {
        const parsed = parseExcel(buffer)
        assert.equal(parsed.rows.length, size.rows)
      })
    })

    it(`validation — customers/${size.name} (${size.rows} rows)`, () => {
      const parsed = parseCsv(fs.readFileSync(path.join(TEST_DATA, 'customers', `${size.name}.csv`), 'utf8'))
      const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
      bench('validate', size.rows, 'csv', () => {
        const mapped = coerceMappedRows(applyColumnMapping(parsed.rows, mapping), CUSTOMER_FIELDS)
        const result = validateMappedRows(mapped, CUSTOMER_FIELDS)
        assert.equal(result.validRowNumbers.length, size.rows)
      })
    })

    it(`auto-map — customers/${size.name} (${size.rows} rows)`, () => {
      const parsed = parseCsv(fs.readFileSync(path.join(TEST_DATA, 'customers', `${size.name}.csv`), 'utf8'))
      bench('auto-map', size.rows, 'csv', () => {
        autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
      })
    })

    it(`CSV export — customers/${size.name} (${size.rows} rows)`, () => {
      const parsed = parseCsv(fs.readFileSync(path.join(TEST_DATA, 'customers', `${size.name}.csv`), 'utf8'))
      const headers = getExportHeaders(CUSTOMER_FIELDS)
      const mapping = autoMapColumns(parsed.headers, CUSTOMER_FIELDS)
      const mapped = applyColumnMapping(parsed.rows, mapping)
      const exportRows = mapped.map((row) => {
        const out: Record<string, string | number | boolean | null> = {}
        for (const h of headers) out[h] = String(row.mapped[h] ?? '')
        return out
      })
      bench('csv-export', size.rows, 'csv', () => {
        serializeExport('csv', headers, exportRows)
      })
    })
  }

  it('prints performance summary', () => {
    const reportPath = path.join(ROOT, 'test-data', 'performance-results.json')
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log('\n--- Performance Results (ms) ---')
    console.table(results)
    console.log(`\nSaved to ${reportPath}`)
    assert.ok(results.length > 0)
  })
})
