import RestorationConfirmationException from '#exceptions/restoration_confirmation_exception'

/** The change clears restorable items, so the caller must confirm it. */
export default class RestorationConfirmationRequiredException extends RestorationConfirmationException {
  static status = 409
  static code = 'RESTORATION_CONFIRMATION_REQUIRED'

  constructor(restorableItemCount: number) {
    super(
      restorableItemCount,
      `This change clears ${restorableItemCount} restorable ${restorableItemCount === 1 ? 'item' : 'items'}`
    )
  }
}
