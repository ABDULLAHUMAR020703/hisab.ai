export class AccountingIntegrationException extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ProviderNotFoundException extends AccountingIntegrationException {
  constructor(provider: string) {
    super(`Accounting provider '${provider}' was not found.`, 404, 'PROVIDER_NOT_FOUND')
  }
}

export class ConnectionAlreadyExistsException extends AccountingIntegrationException {
  constructor() {
    super('An active connection already exists for this provider.', 409, 'CONNECTION_ALREADY_EXISTS')
  }
}

export class ProviderDisabledException extends AccountingIntegrationException {
  constructor(provider: string) {
    super(`Accounting provider '${provider}' is not currently available.`, 409, 'PROVIDER_DISABLED')
  }
}

export class UnauthorizedIntegrationException extends AccountingIntegrationException {
  constructor(message = 'You do not have permission to manage accounting integrations.') {
    super(message, 403, 'UNAUTHORIZED_INTEGRATION')
  }
}

export class ConnectionNotFoundException extends AccountingIntegrationException {
  constructor() {
    super('No current connection exists for this provider.', 404, 'CONNECTION_NOT_FOUND')
  }
}

export class InvalidOAuthStateException extends AccountingIntegrationException {
  constructor() {
    super('The OAuth state is invalid.', 400, 'INVALID_OAUTH_STATE')
  }
}

export class ExpiredOAuthStateException extends AccountingIntegrationException {
  constructor() {
    super('The OAuth authorization request has expired. Start the connection again.', 400, 'EXPIRED_OAUTH_STATE')
  }
}

export class ReusedOAuthStateException extends AccountingIntegrationException {
  constructor() {
    super('This OAuth authorization request has already been used.', 400, 'REUSED_OAUTH_STATE')
  }
}

export class InvalidOAuthCallbackException extends AccountingIntegrationException {
  constructor(message = 'The OAuth callback is missing required parameters.') {
    super(message, 400, 'INVALID_OAUTH_CALLBACK')
  }
}

export class ProviderAuthenticationException extends AccountingIntegrationException {
  constructor(message = 'The provider rejected the stored credentials.') {
    super(message, 401, 'PROVIDER_AUTHENTICATION_FAILED')
  }
}

export class ProviderRequestException extends AccountingIntegrationException {
  constructor(message = 'The accounting provider request failed.', statusCode = 502) {
    super(message, statusCode, 'PROVIDER_REQUEST_FAILED')
  }
}
