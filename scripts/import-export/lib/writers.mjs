import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

export function writeCsv(filePath, headers, rows) {
  const escape = (value) => {
    const str = String(value ?? '')
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
    return str
  }
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ]
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
}

export function writeXlsx(filePath, headers, rows, sheetName = 'Data') {
  const data = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))]
  const sheet = XLSX.utils.aoa_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  XLSX.writeFile(workbook, filePath)
}

export function writeDataset(dir, name, headers, rows) {
  writeCsv(path.join(dir, `${name}.csv`), headers, rows)
  writeXlsx(path.join(dir, `${name}.xlsx`), headers, rows)
}
