import { Exception } from '@adonisjs/core/exceptions';

/** A refused entity write with a safe message; each caller maps `status` to its response. */
export class EntityWriteException extends Exception {
  constructor(
    message: string,
    status = 400,
    readonly current?: Record<string, unknown>,
    code?: string
  ) {
    super(message, { status, code });
  }
}
