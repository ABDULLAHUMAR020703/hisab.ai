export class OwnershipLostError extends Error {
  readonly platformJobId: string
  readonly attempt: number

  constructor(platformJobId: string, attempt: number, message?: string) {
    super(message ?? `Queue ownership lost for job ${platformJobId} attempt ${attempt}.`)
    this.name = 'OwnershipLostError'
    this.platformJobId = platformJobId
    this.attempt = attempt
  }
}

export function isOwnershipLostError(error: unknown): error is OwnershipLostError {
  return error instanceof OwnershipLostError || (error instanceof Error && error.name === 'OwnershipLostError')
}
