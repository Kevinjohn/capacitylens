import RefusalException from '#exceptions/refusal_exception'

/** The record changed or was already used, so the request no longer applies. */
export default class ConflictException extends RefusalException {
  static status = 409
  static code = 'CONFLICT'
}
