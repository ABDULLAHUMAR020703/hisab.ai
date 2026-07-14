import 'server-only'
import type { ModuleDefinition } from '../types'
import { MODULE_CATALOG } from './module-catalog'
import { accountsModule } from './modules/accounts.module'
import { costCentersModule } from './modules/cost-centers.module'
import { customersModule } from './modules/customers.module'
import { employeesModule } from './modules/employees.module'
import { inventoryModule } from './modules/inventory.module'
import { taxRatesModule } from './modules/tax-rates.module'
import { vendorsModule } from './modules/vendors.module'

const modules = new Map<string, ModuleDefinition>([
  [customersModule.key, customersModule],
  [vendorsModule.key, vendorsModule],
  [inventoryModule.key, inventoryModule],
  [accountsModule.key, accountsModule],
  [costCentersModule.key, costCentersModule],
  [employeesModule.key, employeesModule],
  [taxRatesModule.key, taxRatesModule],
])

export function getModuleDefinition(moduleKey: string): ModuleDefinition {
  const module = modules.get(moduleKey)
  if (!module) {
    throw new Error(`Unknown import/export module: ${moduleKey}`)
  }
  return module
}

export function listRegisteredModules(): Array<{ key: string; displayName: string }> {
  return MODULE_CATALOG.map((entry) => ({
    key: entry.key,
    displayName: entry.displayName,
  }))
}

export function isRegisteredModule(moduleKey: string): boolean {
  return modules.has(moduleKey)
}
