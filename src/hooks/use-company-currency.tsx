'use client'

import { createContext, useCallback, useContext } from 'react'
import { DEFAULT_CURRENCY, isSaudiArabia } from '@/lib/currency/constants'
import { formatCurrency as baseFormatCurrency, formatOptionalCurrency as baseFormatOptionalCurrency } from '@/lib/utils'

export interface CompanyCurrencyContextValue {
  currency: string
  country: string
  isSaudi: boolean
}

const CompanyCurrencyContext = createContext<CompanyCurrencyContextValue>({
  currency: DEFAULT_CURRENCY,
  country: 'Saudi Arabia',
  isSaudi: true,
})

export function CompanyCurrencyProvider({
  currency,
  country,
  children,
}: {
  currency: string
  country: string
  children: React.ReactNode
}) {
  const value: CompanyCurrencyContextValue = {
    currency,
    country,
    isSaudi: isSaudiArabia(country),
  }

  return (
    <CompanyCurrencyContext.Provider value={value}>
      {children}
    </CompanyCurrencyContext.Provider>
  )
}

export function useCompanyCurrency() {
  return useContext(CompanyCurrencyContext)
}

/** Returns a formatter bound to the company's primary currency. */
export function useFormatCurrency() {
  const { currency } = useCompanyCurrency()
  return useCallback(
    (amount: number | null | undefined) => baseFormatCurrency(amount, currency),
    [currency],
  )
}

export function useFormatOptionalCurrency() {
  const { currency } = useCompanyCurrency()
  return useCallback(
    (amount: number | null | undefined) => baseFormatOptionalCurrency(amount, currency),
    [currency],
  )
}
