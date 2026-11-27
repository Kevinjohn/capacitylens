import ProductException from '#exceptions/product_exception'

/** Address confirmation committed, but a follow-up step failed. */
export default class VerificationCommittedException extends ProductException {
  static status = 503
  static code = 'E_VERIFICATION_COMMITTED'
  static message =
    'Your address is confirmed and your password is set. Sign in with the new password.'

  override body(): Record<string, unknown> {
    return { ...super.body(), committed: true }
  }

  /** Not reported: the 503 is an expected outcome, and the controller logs its cause where it has one. */
  report() {}
}
