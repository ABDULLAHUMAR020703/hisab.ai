export type TaxCalculationMode = 'EXCLUSIVE' | 'INCLUSIVE'
export type TaxCompoundMethod = 'ADDITIVE' | 'COMPOUND'

export interface TaxRateDefinition {
  id?: string
  name: string
  rate: number
  type?: string
  taxMode?: TaxCalculationMode
  isReverseCharge?: boolean
  isWithholding?: boolean
}

export interface ComputedTaxComponent {
  taxRateId?: string
  name: string
  rate: number
  taxMode: TaxCalculationMode
  taxableAmount: number
  taxAmount: number
  isReverseCharge: boolean
  isWithholding: boolean
}

export interface LineTaxResult {
  quantity: number
  unitPrice: number
  grossAmount: number
  netAmount: number
  taxAmount: number
  effectiveTaxRate: number
  components: ComputedTaxComponent[]
  isExempt: boolean
}

export function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Exclusive tax: tax is added on top of net amount. */
export function calculateExclusiveTax(netAmount: number, rate: number): number {
  return roundMoney(netAmount * (rate / 100))
}

/** Inclusive tax: tax is embedded in gross amount. */
export function calculateInclusiveTax(grossAmount: number, rate: number): number {
  if (rate <= 0) return 0
  return roundMoney(grossAmount - grossAmount / (1 + rate / 100))
}

export function splitInclusiveAmount(grossAmount: number, rate: number): { net: number; tax: number } {
  const tax = calculateInclusiveTax(grossAmount, rate)
  return { net: roundMoney(grossAmount - tax), tax }
}

export function calculateCompoundTaxes(
  netAmount: number,
  rates: TaxRateDefinition[],
  method: TaxCompoundMethod = 'ADDITIVE',
): ComputedTaxComponent[] {
  if (rates.length === 0) return []

  if (method === 'ADDITIVE') {
    return rates.map((r) => {
      const taxAmount = calculateExclusiveTax(netAmount, r.rate)
      return {
        taxRateId: r.id,
        name: r.name,
        rate: r.rate,
        taxMode: r.taxMode ?? 'EXCLUSIVE',
        taxableAmount: netAmount,
        taxAmount,
        isReverseCharge: r.isReverseCharge ?? false,
        isWithholding: r.isWithholding ?? false,
      }
    })
  }

  let runningBase = netAmount
  const components: ComputedTaxComponent[] = []
  for (const r of rates) {
    const taxAmount = calculateExclusiveTax(runningBase, r.rate)
    components.push({
      taxRateId: r.id,
      name: r.name,
      rate: r.rate,
      taxMode: r.taxMode ?? 'EXCLUSIVE',
      taxableAmount: runningBase,
      taxAmount,
      isReverseCharge: r.isReverseCharge ?? false,
      isWithholding: r.isWithholding ?? false,
    })
    runningBase = roundMoney(runningBase + taxAmount)
  }
  return components
}

export function computeLineTaxFromRates(
  quantity: number,
  unitPrice: number,
  rates: TaxRateDefinition[],
  options?: {
    compoundMethod?: TaxCompoundMethod
    isExempt?: boolean
  },
): LineTaxResult {
  const grossAmount = roundMoney(quantity * unitPrice)
  if (options?.isExempt || rates.length === 0) {
    return {
      quantity,
      unitPrice,
      grossAmount,
      netAmount: grossAmount,
      taxAmount: 0,
      effectiveTaxRate: 0,
      components: [],
      isExempt: Boolean(options?.isExempt),
    }
  }

  const primaryMode = rates[0]?.taxMode ?? 'EXCLUSIVE'

  if (primaryMode === 'INCLUSIVE' && rates.length === 1) {
    const rate = rates[0]
    const { net, tax } = splitInclusiveAmount(grossAmount, rate.rate)
    return {
      quantity,
      unitPrice,
      grossAmount,
      netAmount: net,
      taxAmount: tax,
      effectiveTaxRate: rate.rate,
      components: [{
        taxRateId: rate.id,
        name: rate.name,
        rate: rate.rate,
        taxMode: 'INCLUSIVE',
        taxableAmount: net,
        taxAmount: tax,
        isReverseCharge: rate.isReverseCharge ?? false,
        isWithholding: rate.isWithholding ?? false,
      }],
      isExempt: false,
    }
  }

  const components = calculateCompoundTaxes(
    grossAmount,
    rates,
    options?.compoundMethod ?? 'ADDITIVE',
  )
  const taxAmount = roundMoney(components.reduce((s, c) => s + c.taxAmount, 0))
  const netAmount = primaryMode === 'INCLUSIVE' ? roundMoney(grossAmount - taxAmount) : grossAmount

  return {
    quantity,
    unitPrice,
    grossAmount,
    netAmount,
    taxAmount,
    effectiveTaxRate: grossAmount > 0 ? roundMoney((taxAmount / grossAmount) * 100) : 0,
    components,
    isExempt: false,
  }
}

/** Legacy exclusive VAT calculation — preserves existing 15% behavior. */
export function computeLegacyLineTax(quantity: number, unitPrice: number, taxRate: number): LineTaxResult {
  return computeLineTaxFromRates(quantity, unitPrice, [{
    name: 'VAT',
    rate: taxRate,
    taxMode: 'EXCLUSIVE',
    type: 'VAT',
  }])
}

export function sumDocumentTaxes(lines: LineTaxResult[]): {
  subtotal: number
  taxAmount: number
  total: number
  withholdingAmount: number
  reverseChargeAmount: number
} {
  let subtotal = 0
  let taxAmount = 0
  let withholdingAmount = 0
  let reverseChargeAmount = 0

  for (const line of lines) {
    subtotal += line.netAmount
    taxAmount += line.taxAmount
    for (const c of line.components) {
      if (c.isWithholding) withholdingAmount += c.taxAmount
      if (c.isReverseCharge) reverseChargeAmount += c.taxAmount
    }
  }

  return {
    subtotal: roundMoney(subtotal),
    taxAmount: roundMoney(taxAmount),
    total: roundMoney(subtotal + taxAmount),
    withholdingAmount: roundMoney(withholdingAmount),
    reverseChargeAmount: roundMoney(reverseChargeAmount),
  }
}
