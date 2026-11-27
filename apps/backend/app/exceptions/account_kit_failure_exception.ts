import UnexpectedException from '#exceptions/unexpected_exception'

/** An Account Kit server fault, logged under its own category. */
export default class AccountKitFailureException extends UnexpectedException {
  static code = 'E_ACCOUNT_KIT_FAILURE'
  override readonly errorType = 'account_kit_failure'
}
