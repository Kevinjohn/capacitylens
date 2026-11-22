import { Exception } from '@adonisjs/core/exceptions';

/** A stale-revision conflict; the authoritative comparison occurs under the write transaction. */
export class StalePlanningRevisionException extends Exception {
  static status = 409;
  static code = 'STALE_REVISION';

  constructor(
    readonly mutationId: string,
    readonly baseRevision: number,
    readonly currentRevision: number
  ) {
    super('The planning revision changed before this mutation was applied.');
  }
}
