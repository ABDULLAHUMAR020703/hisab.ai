import { ProviderRequestException } from '../../utils/exceptions'

export type QuickBooksEnvironment = 'sandbox' | 'production'

export interface QuickBooksConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  environment: QuickBooksEnvironment
  additionalScopes?: string[]
}

export interface QuickBooksEndpoints {
  authorization: string
  token: string
  revoke: string
  api: string
}

export function quickBooksConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QuickBooksConfig {
  const clientId = env.QB_CLIENT_ID?.trim()
  const clientSecret = env.QB_CLIENT_SECRET?.trim()
  const redirectUri = env.QB_REDIRECT_URI?.trim()
  const environment = env.QB_ENVIRONMENT?.trim().toLowerCase() || 'sandbox'
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ProviderRequestException('QuickBooks OAuth is not configured on the server.', 503)
  }
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new ProviderRequestException("QB_ENVIRONMENT must be 'sandbox' or 'production'.", 503)
  }
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    throw new ProviderRequestException('QB_REDIRECT_URI must be an absolute URL.', 503)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ProviderRequestException('QB_REDIRECT_URI must use HTTP or HTTPS.', 503)
  }
  const additionalScopes = (env.QB_ADDITIONAL_SCOPES ?? '').split(/[ ,]+/).map(scope => scope.trim()).filter(Boolean)
  return { clientId, clientSecret, redirectUri, environment, additionalScopes }
}

export function quickBooksEndpoints(environment: QuickBooksEnvironment): QuickBooksEndpoints {
  return {
    authorization: 'https://appcenter.intuit.com/connect/oauth2',
    token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    api: environment === 'sandbox'
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com',
  }
}
