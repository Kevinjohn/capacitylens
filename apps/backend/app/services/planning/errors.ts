/** A refused entity write with a safe message; each caller maps `status` to its response. */
export class EntityWriteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly current?: Record<string, unknown>,
    readonly code?: string
  ) {
    super(message);
  }
}
