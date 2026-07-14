import 'server-only'
import type { CustomerRecord } from '@/lib/db/entities'
import { getCustomerRepository } from '@/lib/db/provider'
import type {
  CustomerBalanceFilter,
  CustomerListOptions,
  CustomerVatFilter,
} from '@/lib/db/repositories/customer.repository.interface'
import {
  parseBooleanField,
  parseNumberField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { CUSTOMER_FIELDS } from './customers.fields'
import { CUSTOMER_OFFICIAL_TEMPLATES } from './customers.official-templates'

export { CUSTOMER_FIELDS } from './customers.fields'

export interface CustomerImportRecord {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  creditLimit?: number
  paymentTerms?: number
  isActive?: boolean
}

function parseCustomerImportRow(mapped: Record<string, unknown>): CustomerImportRecord {
  return {
    name: String(mapped.name ?? '').trim(),
    email: parseOptionalString(mapped.email),
    phone: parseOptionalString(mapped.phone),
    address: parseOptionalString(mapped.address),
    city: parseOptionalString(mapped.city),
    country: parseOptionalString(mapped.country),
    taxId: parseOptionalString(mapped.taxId),
    creditLimit: parseNumberField(mapped.creditLimit, 0),
    paymentTerms: parseNumberField(mapped.paymentTerms, 30),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

function buildCustomerListOptions(filters: Record<string, string>): CustomerListOptions {
  return {
    search: filters.search || undefined,
    country: filters.country || undefined,
    city: filters.city || undefined,
    vatFilter: (filters.vatFilter as CustomerVatFilter) || undefined,
    balanceFilter: (filters.balanceFilter as CustomerBalanceFilter) || undefined,
    sortBy: (filters.sortBy as CustomerListOptions['sortBy']) || 'name',
    sortDir: filters.sortDir === 'desc' ? 'desc' : 'asc',
  }
}

export const customersModule: ModuleDefinition = {
  key: 'customers',
  displayName: 'Customers',
  fields: CUSTOMER_FIELDS,
  officialTemplates: CUSTOMER_OFFICIAL_TEMPLATES,
  duplicateKeys: ['email', 'taxId', 'name'],

  parseImportRow: (mapped) => parseCustomerImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record, _ctx) {
    const parsed = parseCustomerImportRow(record)
    const repo = getCustomerRepository()
    const existing = await repo.findDuplicate({
      email: parsed.email,
      taxId: parsed.taxId,
      name: parsed.name,
    })
    if (!existing) return null

    const matchedOn: string[] = []
    if (parsed.email && existing.email?.toLowerCase() === parsed.email.toLowerCase()) {
      matchedOn.push('email')
    } else if (parsed.taxId && existing.taxId === parsed.taxId) {
      matchedOn.push('taxId')
    } else if (parsed.name && existing.name.toLowerCase() === parsed.name.toLowerCase()) {
      matchedOn.push('name')
    }

    return { id: existing.id, matchedOn: matchedOn.length ? matchedOn : ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getCustomerRepository()
    const inputs = rows.map((row) => {
      const parsed = parseCustomerImportRow(row.mapped)
      return {
        rowNumber: row.rowNumber,
        email: parsed.email,
        taxId: parsed.taxId,
        name: parsed.name,
      }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record, _ctx) {
    const parsed = parseCustomerImportRow(record)
    const repo = getCustomerRepository()
    const created = await repo.create({
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      address: parsed.address,
      city: parsed.city,
      country: parsed.country,
      taxId: parsed.taxId,
      creditLimit: parsed.creditLimit ?? 0,
      paymentTerms: parsed.paymentTerms ?? 30,
      isActive: parsed.isActive ?? true,
    })
    return { id: created.id }
  },

  async updateRecord(id, record, _ctx) {
    const parsed = parseCustomerImportRow(record)
    const repo = getCustomerRepository()
    await repo.update(id, {
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      address: parsed.address,
      city: parsed.city,
      country: parsed.country,
      taxId: parsed.taxId,
      creditLimit: parsed.creditLimit,
      paymentTerms: parsed.paymentTerms,
      isActive: parsed.isActive,
    })
  },

  async exportRecords(filters, _ctx) {
    const repo = getCustomerRepository()
    return repo.findMany({
      ...buildCustomerListOptions(filters),
      includeOutstanding: false,
    })
  },

  mapExportRow(record) {
    const customer = record as CustomerRecord
    return {
      customerNo: customer.customerNo,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      country: customer.country,
      taxId: customer.taxId,
      creditLimit: customer.creditLimit,
      paymentTerms: customer.paymentTerms,
      isActive: customer.isActive,
    }
  },
}
