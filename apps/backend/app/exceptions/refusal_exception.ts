import { ProductException } from '#exceptions/product_exception';

/** An expected product refusal. Each cause is a subclass that states its status and code. */
export class RefusalException extends ProductException {
  constructor(message?: string) {
    super(message);
  }
}

/** The named record is missing, or the caller may not know it exists. */
export class NotFoundException extends RefusalException {
  static status = 404;
  static code = 'NOT_FOUND';
}

/** The record changed or was already used, so the request no longer applies. */
export class ConflictException extends RefusalException {
  static status = 409;
  static code = 'CONFLICT';
}

/** The caller's membership does not allow the action. */
export class ForbiddenException extends RefusalException {
  static status = 403;
  static code = 'FORBIDDEN';
  static message = 'Forbidden.';
}
