import RefusalException from '#exceptions/refusal_exception';

/** The caller's membership does not allow the action. */
export default class ForbiddenException extends RefusalException {
  static status = 403;
  static code = 'FORBIDDEN';
  static message = 'Forbidden.';
}
