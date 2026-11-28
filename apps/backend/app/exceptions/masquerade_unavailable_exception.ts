import UnexpectedException from '#exceptions/unexpected_exception'

/** The masquerade package cannot serve the request; it answers 503 and is logged as a fault. */
export default class MasqueradeUnavailableException extends UnexpectedException {
  static status = 503
  static code = 'E_MASQUERADE_UNAVAILABLE'
  static message = 'Masquerade is unavailable.'
}
