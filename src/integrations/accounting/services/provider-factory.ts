import type { AccountingProvider } from '../contracts/accounting-provider'
import type { Provider } from '../contracts/types'
import { ProviderNotFoundException } from '../utils/exceptions'

export class ProviderFactory {
  private readonly providers: Map<Provider, AccountingProvider>

  constructor(providers: AccountingProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.slug, provider]))
  }

  get(provider: Provider): AccountingProvider {
    const implementation = this.providers.get(provider)
    if (!implementation) throw new ProviderNotFoundException(provider)
    return implementation
  }
}
