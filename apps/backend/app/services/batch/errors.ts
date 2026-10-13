export class BatchRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly current?: Record<string, unknown>,
    readonly code?: string
  ) {
    super(message)
  }
}
