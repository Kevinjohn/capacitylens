import ProductException from '#exceptions/product_exception'

/** A stale-revision conflict; the authoritative comparison occurs under the write transaction. */
export default class StalePlanningRevisionException extends ProductException {
  static status = 409
  static code = 'E_STALE_REVISION'

  constructor(
    readonly mutationId: string,
    readonly baseRevision: number,
    readonly currentRevision: number
  ) {
    super('The planning revision changed before this mutation was applied.')
  }
}
