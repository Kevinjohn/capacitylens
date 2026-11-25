import { PlanningOperationException } from '#exceptions/planning_operation_exception';

/** Carries only the count required for an explicit, revision-bound cleanup decision. */
abstract class RestorationConfirmationException extends PlanningOperationException {
  constructor(
    readonly restorableItemCount: number,
    message?: string
  ) {
    super(message);
  }

  override body() {
    return { ...super.body(), restorableItemCount: this.restorableItemCount };
  }
}

/** The change clears restorable items, so the caller must confirm it. */
export class RestorationConfirmationRequiredException extends RestorationConfirmationException {
  static status = 409;
  static code = 'RESTORATION_CONFIRMATION_REQUIRED';

  constructor(restorableItemCount: number) {
    super(
      restorableItemCount,
      `This change clears ${restorableItemCount} restorable ${restorableItemCount === 1 ? 'item' : 'items'}`
    );
  }
}

/** The restorable items changed after the caller confirmed. */
export class RestorationConfirmationStaleException extends RestorationConfirmationException {
  static status = 409;
  static code = 'RESTORATION_CONFIRMATION_STALE';
  static message = 'The restorable items changed. Review this change again.';
}
