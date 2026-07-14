export type ReportCategory = 'financial' | 'operational' | 'analytics' | 'custom'

export type PeriodPreset =
  | 'custom'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'ytd'
  | 'last_month'
  | 'last_quarter'
  | 'last_year'

export type ReportExportFormat = 'json' | 'csv' | 'xlsx' | 'pdf' | 'print'

export interface ReportPeriod {
  from: string
  to: string
  preset?: PeriodPreset
  label?: string
}

export interface ReportFilter {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'between'
  value: unknown
}

export interface ReportColumn {
  key: string
  label: string
  type?: 'string' | 'number' | 'date' | 'currency' | 'percent'
  visible?: boolean
  width?: number
}

export interface ReportSort {
  field: string
  direction: 'asc' | 'desc'
}

export interface ReportGrouping {
  field: string
  label?: string
}

export interface CalculatedColumn {
  key: string
  label: string
  formula: string
}

export interface ReportRunRequest {
  reportKey: string
  period?: ReportPeriod
  asOf?: string
  filters?: ReportFilter[]
  columns?: string[]
  grouping?: ReportGrouping[]
  sorting?: ReportSort[]
  page?: number
  pageSize?: number
  comparePeriod?: ReportPeriod
  drillDown?: { field: string; value: unknown }
  companyId?: string
  definitionId?: string
}

export interface ReportPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ReportRunResult<T = unknown> {
  reportKey: string
  title: string
  category: ReportCategory
  generatedAt: string
  period?: ReportPeriod
  asOf?: string
  data: T
  rows?: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
  pagination?: ReportPagination
  drillDown?: { available: boolean; fields: string[] }
  meta?: Record<string, unknown>
}

export interface ReportCatalogEntry {
  key: string
  title: string
  description: string
  category: ReportCategory
  supportsExport: boolean
  supportsCompare: boolean
  supportsDrillDown: boolean
  filterFields: string[]
  columnFields: string[]
  groupFields: string[]
}

export interface ReportDefinitionRecord {
  id: string
  company_id: string
  name: string
  description?: string | null
  base_report_key: string
  layout: Record<string, unknown>
  columns: unknown[]
  filters: unknown[]
  grouping: unknown[]
  sorting: unknown[]
  calculated_columns: unknown[]
  is_shared: boolean
  created_by_id?: string | null
}
