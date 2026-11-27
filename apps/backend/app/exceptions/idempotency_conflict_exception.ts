import RefusalException from '#exceptions/refusal_exception';

/** The operation id was already used for a different account operation. */
export default class IdempotencyConflictException extends RefusalException {
  static status = 409;
  static code = 'E_IDEMPOTENCY_CONFLICT';
  static message = 'Operation id already used.';
}
