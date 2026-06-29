export class TenantAccessError extends Error {
  constructor(message = 'No company membership for this account') {
    super(message)
    this.name = 'TenantAccessError'
  }
}
