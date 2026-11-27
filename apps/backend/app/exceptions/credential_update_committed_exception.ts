import ProductException from '#exceptions/product_exception'

/** The password change committed, but a follow-up step failed. */
export default class CredentialUpdateCommittedException extends ProductException {
  static status = 503
  static code = 'E_CREDENTIAL_UPDATE_COMMITTED'
  static message =
    'Your password was changed, but a follow-up step failed. Sign in with the new password.'

  override body(): Record<string, unknown> {
    return { ...super.body(), committed: true }
  }

  /** Not reported: the 503 is an expected outcome, and the controller logs its cause where it has one. */
  report() {}
}
