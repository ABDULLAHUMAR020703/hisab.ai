import 'server-only'
import type { VendorRecord } from '@/lib/db/entities'
import { getVendorRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseNumberField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { VENDOR_FIELDS } from './vendors.fields'
import { VENDOR_OFFICIAL_TEMPLATES } from './vendors.official-templates'

export { VENDOR_FIELDS } from './vendors.fields'

function parseVendorImportRow(mapped: Record<string, unknown>) {
  return {
    name: String(mapped.name ?? '').trim(),
    email: parseOptionalString(mapped.email),
    phone: parseOptionalString(mapped.phone),
    address: parseOptionalString(mapped.address),
    city: parseOptionalString(mapped.city),
    country: parseOptionalString(mapped.country),
    taxId: parseOptionalString(mapped.taxId),
    paymentTerms: parseNumberField(mapped.paymentTerms, 30),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

function matchVendorDuplicate(
  parsed: ReturnType<typeof parseVendorImportRow>,
  existing: VendorRecord,
): string[] {
  const matchedOn: string[] = []
  if (parsed.email && existing.email?.toLowerCase() === parsed.email.toLowerCase()) {
    matchedOn.push('email')
  } else if (parsed.taxId && existing.taxId === parsed.taxId) {
    matchedOn.push('taxId')
  } else if (parsed.name && existing.name.toLowerCase() === parsed.name.toLowerCase()) {
    matchedOn.push('name')
  }
  return matchedOn
}

export const vendorsModule: ModuleDefinition = {
  key: 'vendors',
  displayName: 'Vendors',
  fields: VENDOR_FIELDS,
  officialTemplates: VENDOR_OFFICIAL_TEMPLATES,
  duplicateKeys: ['email', 'taxId', 'name'],

  transformOfficialRow(mapped, templateId) {
    if (templateId !== 'standard') return mapped
    const contact = mapped.contactPerson
    if (contact && String(contact).trim()) {
      const addr = String(mapped.address ?? '').trim()
      mapped.address = addr
        ? `${addr} (Contact: ${String(contact).trim()})`
        : `Contact: ${String(contact).trim()}`
    }
    const { contactPerson: _contact, ...rest } = mapped
    return rest
  },

  parseImportRow: (mapped) => parseVendorImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseVendorImportRow(record)
    const existing = await getVendorRepository().findDuplicate({
      email: parsed.email,
      taxId: parsed.taxId,
      name: parsed.name,
    })
    if (!existing) return null
    const matchedOn = matchVendorDuplicate(parsed, existing)
    return { id: existing.id, matchedOn: matchedOn.length ? matchedOn : ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getVendorRepository()
    const inputs = rows.map((row) => {
      const parsed = parseVendorImportRow(row.mapped)
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

  async createRecord(record) {
    const parsed = parseVendorImportRow(record)
    const created = await getVendorRepository().create(parsed)
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseVendorImportRow(record)
    await getVendorRepository().update(id, parsed)
  },

  async exportRecords(filters) {
    return getVendorRepository().findMany({
      search: filters.search || undefined,
      includeOutstanding: false,
    })
  },

  mapExportRow(record) {
    const vendor = record as VendorRecord
    return {
      vendorNo: vendor.vendorNo,
      name: vendor.name,
      email: vendor.email,
      phone: vendor.phone,
      address: vendor.address,
      city: vendor.city,
      country: vendor.country,
      taxId: vendor.taxId,
      paymentTerms: vendor.paymentTerms,
      isActive: vendor.isActive,
    }
  },
}
