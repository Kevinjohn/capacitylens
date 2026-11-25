import RestorationConfirmationException from '#exceptions/restoration_confirmation_exception';

/** The restorable items changed after the caller confirmed. */
export default class RestorationConfirmationStaleException extends RestorationConfirmationException {
  static status = 409;
  static code = 'RESTORATION_CONFIRMATION_STALE';
  static message = 'The restorable items changed. Review this change again.';
}
