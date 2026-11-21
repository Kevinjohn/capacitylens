/** A stale-revision conflict; the authoritative comparison occurs under the write transaction. */
export class StalePlanningRevisionException extends Error {
  readonly statusCode = 409;
  readonly code = 'STALE_REVISION' as const;

  constructor(
    readonly mutationId: string,
    readonly baseRevision: number,
    readonly currentRevision: number
  ) {
    super('The planning revision changed before this mutation was applied.');
    this.name = 'StalePlanningRevisionException';
  }
}
