import {
  ProviderRequestException,
  SandboxConnectionNotAllowedException,
} from '../../utils/exceptions'

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

/**
 * Resolve the process QuickBooks environment.
 * Explicit QB_ENVIRONMENT wins. Otherwise production NODE_ENV → production,
 * everything else → sandbox (local/dev/test).
 */
export function resolveQuickBooksEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): QuickBooksEnvironment {
  const explicit = env.QB_ENVIRONMENT?.trim().toLowerCase()
  if (explicit === 'sandbox' || explicit === 'production') return explicit
  if (explicit) {
    throw new ProviderRequestException("QB_ENVIRONMENT must be 'sandbox' or 'production'.", 503)
  }
  return env.NODE_ENV === 'production' ? 'production' : 'sandbox'
}

/**
 * Legacy connection rows store NULL environment. Treat them as sandbox so they
 * cannot be reused as production after QB_ENVIRONMENT is switched.
 */
export function resolveStoredConnectionEnvironment(
  stored: string | null | undefined,
): QuickBooksEnvironment {
  return stored === 'production' ? 'production' : 'sandbox'
}

/**
 * Reject sandbox (or env-mismatched) connections when the process targets
 * production, and reject any connection/process environment mismatch.
 */
export function assertQuickBooksConnectionEnvironment(input: {
  connectionEnvironment: string | null | undefined
  processEnvironment: QuickBooksEnvironment
  forMigration?: boolean
}): QuickBooksEnvironment {
  const connectionEnvironment = resolveStoredConnectionEnvironment(input.connectionEnvironment)

  if (connectionEnvironment !== input.processEnvironment) {
    if (input.processEnvironment === 'production' || input.forMigration) {
      throw new SandboxConnectionNotAllowedException()
    }
    throw new ProviderRequestException(
      `QuickBooks is connected to a ${connectionEnvironment} company, but this server is configured for ${input.processEnvironment}. Disconnect and reconnect QuickBooks to continue.`,
      409,
    )
  }

  if (input.forMigration && connectionEnvironment !== 'production' && input.processEnvironment === 'production') {
    throw new SandboxConnectionNotAllowedException()
  }

  return connectionEnvironment
}

export function quickBooksConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QuickBooksConfig {
  const clientId = env.QB_CLIENT_ID?.trim()
  const clientSecret = env.QB_CLIENT_SECRET?.trim()
  const redirectUri = env.QB_REDIRECT_URI?.trim()
  const environment = resolveQuickBooksEnvironment(env)
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ProviderRequestException('QuickBooks OAuth is not configured on the server.', 503)
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
