import { ProductException } from '#exceptions/product_exception';
import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/**
 * A safe refusal whose caller must roll back the enclosing planning transaction. Each cause is a
 * subclass that states its status and code.
 */
export class PlanningOperationException extends ProductException {
  declare readonly code?: PlanningMutationErrorCode;
}

/**
 * `ACCOUNT_MEMBERSHIP_LOST` is behaviour, not wording: it tells the browser to drop its planning
 * projection, so one sentence and one code answer every lost company membership.
 */
export class MembershipLostException extends PlanningOperationException {
  static status = 403;
  static code = 'ACCOUNT_MEMBERSHIP_LOST';
  static message = 'Company membership is unavailable.';
}

/** The actor may not perform this planning action. */
export class PlanningAuthorizationException extends PlanningOperationException {
  static status = 403;
  static code = 'AUTHORIZATION_DENIED';
  static message = 'This action is not allowed.';
}

/** The record changed after the caller opened it. */
export class RecordChangedException extends PlanningOperationException {
  static status = 409;
  static code = 'STALE_REVISION';
  static message = 'The record changed since it was opened.';
}

/** The mutation identity already committed a different mutation. */
export class MutationIdReusedException extends PlanningOperationException {
  static status = 409;
  static code = 'MUTATION_ID_REUSED';
  static message = 'This mutation identity has already committed.';
}

/** The operation would leave planning data as it is. */
export class NoChangeException extends PlanningOperationException {
  static status = 400;
  static code = 'NO_CHANGE';
}

/** The planning data no longer allows the operation; the sentence names why. */
export class PlanningConflictException extends PlanningOperationException {
  static status = 409;
}
