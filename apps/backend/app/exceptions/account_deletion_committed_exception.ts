import ProductException from '#exceptions/product_exception'

/** The account was deleted, but a follow-up step failed after the transaction committed. */
export default class AccountDeletionCommittedException extends ProductException {
  static status = 503
  static code = 'E_ACCOUNT_DELETION_COMMITTED'
  static message = 'Your account was deleted, but a follow-up step failed. You are signed out.'

  override body(): Record<string, unknown> {
    return { ...super.body(), committed: true }
  }
}
