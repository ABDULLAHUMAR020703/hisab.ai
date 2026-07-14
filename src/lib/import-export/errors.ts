export class FrameworkNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameworkNotFoundError'
  }
}

export class FrameworkBadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameworkBadRequestError'
  }
}
