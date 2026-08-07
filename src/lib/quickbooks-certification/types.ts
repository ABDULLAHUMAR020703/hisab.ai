export const CERTIFICATION_REPORTS = [
  'trial-balance','balance-sheet','profit-loss','general-ledger','aged-ar','aged-ap',
  'cash-flow','inventory-valuation','tax-summary','tax-detail','customer-balances','vendor-balances',
] as const

export type CertificationReportKey = typeof CERTIFICATION_REPORTS[number]
export type CertificationAuxiliaryKey = 'fx-exchange-rates'|'fx-transactions'|'fx-currency-balances'|'fx-realized'|'fx-unrealized'|'fx-revaluations'|'fx-accounts'|'payment-allocations'|'deposit-reconciliation'|'vendor-credit-reconciliation'|'sales-receipt-reconciliation'|'retained-earnings-reconciliation'
export type CertificationSectionKey = CertificationReportKey|CertificationAuxiliaryKey|'cross-report'
export type CertificationStatus = 'CERTIFIED'|'CERTIFIED_WITH_WARNINGS'|'FAILED'
export type CertificationSectionStatus = 'MATCHED'|'WARNING'|'FAILED'|'UNAVAILABLE'

export interface CertificationParameters {
  startDate:string
  endDate:string
  asOfDate:string
  accountingBasis:'Cash'|'Accrual'
  homeCurrency:string
  multiCurrency:boolean
  exact:boolean
  absoluteTolerance:number
  relativeTolerance:number
  classIds?:string[]
  departmentIds?:string[]
  projectIds?:string[]
  customerIds?:string[]
  vendorIds?:string[]
}

export interface CertificationRow {
  key:string
  label:string
  values:Record<string,number>
  dimensions?:Record<string,string>
  sourceRefs?:Array<{sourceType?:string;sourceId?:string;documentId?:string}>
}

export interface FinancialReportSnapshot {
  reportKey:CertificationReportKey
  parameters:CertificationParameters
  currency:string
  rows:CertificationRow[]
  totals:Record<string,number>
  raw?:unknown
}

export interface CertificationDifference {
  reportKey:CertificationSectionKey
  key:string
  label:string
  metric:string
  quickBooksValue:number
  hisabValue:number
  difference:number
  materiality:number
  severity:'WARNING'|'ERROR'
  recommendedAction:string
  sourceRefs?:CertificationRow['sourceRefs']
}

export interface CertificationSection {
  reportKey:CertificationSectionKey
  label:string
  status:CertificationSectionStatus
  quickBooksHash?:string
  hisabHash?:string
  matchedRows:number
  comparedRows:number
  maximumDifference:number
  differences:CertificationDifference[]
  error?:string
  details?:unknown
}

export interface AccountingCertificationReport {
  id:string
  realmId:string
  generatedAt:string
  status:CertificationStatus
  parameters:CertificationParameters
  sections:CertificationSection[]
  summary:{matched:number;warnings:number;failed:number;unavailable:number;differenceCount:number}
  reviewer?:string|null
  approvalStatus:'PENDING'|'APPROVED'|'REJECTED'
}
