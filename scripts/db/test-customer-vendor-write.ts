/**
 * D5 validation: customer + vendor write cutover against active repository backend.
 * Run: npm run db:test-customer-vendor-write
 */
import { loadProjectEnv } from './migration/lib/load-env'

loadProjectEnv()

const marker = `D5-${Date.now()}`

async function main() {
  const { getCustomerRepository, getVendorRepository } = await import('../../src/lib/db/provider')
  const { isSupabaseEnabled } = await import('../../src/lib/supabase/env')

  console.log('Data backend=Supabase')
  console.log(`Active backend: ${isSupabaseEnabled() ? 'Supabase' : 'Prisma/SQLite'}`)
  console.log('---')

  const customers = getCustomerRepository()
  const vendors = getVendorRepository()

  // Customer CRUD
  const createdCustomer = await customers.create({
    name: `Test Customer ${marker}`,
    email: `${marker}@test.hisab.ai`,
    phone: '0500000000',
    city: 'Riyadh',
    country: 'Saudi Arabia',
  })
  console.log('Customer create:', createdCustomer.customerNo, createdCustomer.id)

  const listedCustomers = await customers.findMany({ search: marker })
  if (!listedCustomers.some((c) => c.id === createdCustomer.id)) {
    throw new Error('Customer not visible in findMany immediately after create')
  }
  console.log('Customer list after create: PASS')

  const updatedCustomer = await customers.update(createdCustomer.id, {
    name: `Updated Customer ${marker}`,
    phone: '0500000001',
  })
  if (updatedCustomer.name !== `Updated Customer ${marker}`) {
    throw new Error('Customer update did not persist name')
  }
  console.log('Customer update: PASS')

  await customers.delete(createdCustomer.id)
  const deletedCustomer = await customers.findById(createdCustomer.id)
  if (deletedCustomer) {
    throw new Error('Customer still visible after delete')
  }
  console.log('Customer delete: PASS')

  // Vendor CRUD
  const createdVendor = await vendors.create({
    name: `Test Vendor ${marker}`,
    email: `${marker}-vendor@test.hisab.ai`,
    phone: '0500000002',
    city: 'Jeddah',
    country: 'Saudi Arabia',
  })
  console.log('Vendor create:', createdVendor.vendorNo, createdVendor.id)

  const listedVendors = await vendors.findMany({ search: marker })
  if (!listedVendors.some((v) => v.id === createdVendor.id)) {
    throw new Error('Vendor not visible in findMany immediately after create')
  }
  console.log('Vendor list after create: PASS')

  const updatedVendor = await vendors.update(createdVendor.id, {
    name: `Updated Vendor ${marker}`,
    phone: '0500000003',
  })
  if (updatedVendor.name !== `Updated Vendor ${marker}`) {
    throw new Error('Vendor update did not persist name')
  }
  console.log('Vendor update: PASS')

  await vendors.delete(createdVendor.id)
  const deletedVendor = await vendors.findById(createdVendor.id)
  if (deletedVendor) {
    throw new Error('Vendor still visible after delete')
  }
  console.log('Vendor delete: PASS')

  console.log('---')
  console.log('All D5 customer/vendor write validations PASS')
}

main().catch((error) => {
  console.error('D5 validation FAILED:', error)
  process.exit(1)
})
