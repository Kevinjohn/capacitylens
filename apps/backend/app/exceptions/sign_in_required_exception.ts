import ProductException from '#exceptions/product_exception'

/** The caller is signed out; carries setup and password-reset metadata for the sign-in screen. */
export default class SignInRequiredException extends ProductException {
  static status = 401
  static code = 'E_SIGN_IN_REQUIRED'
  static message = 'Sign-in required.'

  readonly #passwordResetEmail: boolean
  readonly #needsSetup: boolean

  constructor(options: { passwordResetEmail: boolean; needsSetup: boolean }) {
    super()
    this.#passwordResetEmail = options.passwordResetEmail
    this.#needsSetup = options.needsSetup
  }

  override body(): Record<string, unknown> {
    return {
      ...super.body(),
      passwordResetEmail: this.#passwordResetEmail,
      ...(this.#needsSetup ? { needsSetup: true } : {}),
    }
  }
}
