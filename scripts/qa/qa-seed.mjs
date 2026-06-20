/**
 * Load QA test data into the database.
 * Usage: npx tsx scripts/qa/qa-seed.mjs [--force]
 */
process.env.ZATCA_MOCK_ONBOARDING ??= 'true'
process.env.ZATCA_MOCK_SUBMISSION ??= 'true'

const force = process.argv.includes('--force')

const { seedQaData } = await import('../../src/lib/qa-seed.ts')
const result = await seedQaData({ force })

console.log(`\nQA Seed: ${result.status.toUpperCase()}`)
console.log(`  Customers: ${result.customers}`)
console.log(`  Inventory: ${result.inventory}`)
console.log(`  Invoices:  ${result.invoices}`)
console.log(`  Vendors:   ${result.vendors}`)
console.log(`  ${result.message}\n`)

process.exit(result.status === 'skipped' ? 0 : 0)
