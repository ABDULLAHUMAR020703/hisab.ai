import { prisma } from '@/lib/prisma'
import { ZATCA_FIRST_PIH_BASE64 } from './constants'
import { generateZatcaInvoiceXml } from './generate'
import {
  generateInvoiceHash,
  getNextInvoiceCounterValue,
  getPreviousInvoiceHash,
  invoiceHashHexToPihBase64,
} from './hash'
import type { ZatcaInvoiceInput, ZatcaXmlGenerationResult } from './types'

export interface LoadedZatcaInvoice {
  invoice: NonNullable<Awaited<ReturnType<typeof loadZatcaInvoiceById>>>
  input: ZatcaInvoiceInput
}

export async function loadZatcaInvoiceById(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      lines: true,
    },
  })

  if (!invoice) return null

  const companySettings = await prisma.companySettings.findFirst()
  if (!companySettings) return null

  const input: ZatcaInvoiceInput = {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    invoiceUUID: invoice.invoiceUUID,
    invoiceType: invoice.invoiceType,
    date: invoice.date,
    issueTime: invoice.issueTime,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    notes: invoice.notes,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      amount: line.amount,
    })),
    customer: invoice.customer,
    companySettings,
  }

  return { invoice, input, companySettings }
}

export interface ZatcaProcessedInvoice extends ZatcaXmlGenerationResult {
  invoiceId: string
  hash: string
  previousHash: string | null
}

/** Enriches invoice input with ZATCA ICV and PIH chain values. */
export async function enrichZatcaInvoiceInput(
  input: ZatcaInvoiceInput,
  invoiceId: string,
): Promise<ZatcaInvoiceInput> {
  const invoiceCounterValue = await getNextInvoiceCounterValue(invoiceId)
  const previousHashHex = await getPreviousInvoiceHash(invoiceId)
  const previousInvoiceHashBase64 = previousHashHex
    ? invoiceHashHexToPihBase64(previousHashHex)
    : ZATCA_FIRST_PIH_BASE64

  return {
    ...input,
    invoiceCounterValue,
    previousInvoiceHashBase64,
  }
}

/**
 * Generates XML, computes hash chain values, and optionally persists hashes.
 */
export async function processZatcaInvoice(
  invoiceId: string,
  options: { persistHash?: boolean } = { persistHash: true },
): Promise<ZatcaProcessedInvoice | null> {
  const loaded = await loadZatcaInvoiceById(invoiceId)
  if (!loaded) return null

  const enrichedInput = await enrichZatcaInvoiceInput(loaded.input, invoiceId)
  const xmlResult = generateZatcaInvoiceXml(enrichedInput)
  if (!xmlResult.validation.valid) {
    return {
      ...xmlResult,
      invoiceId,
      hash: '',
      previousHash: null,
    }
  }

  const hash = generateInvoiceHash(xmlResult.xml)
  const previousHash = await getPreviousInvoiceHash(invoiceId)

  if (options.persistHash) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceHash: hash,
        previousInvoiceHash: previousHash,
      },
    })
  }

  return {
    ...xmlResult,
    invoiceId,
    hash,
    previousHash,
  }
}
