import { PlanningOperationException } from '#exceptions/planning_operation_exception';

/** Carries only the count required for an explicit, revision-bound cleanup decision. */
export class RestorationConfirmationException extends PlanningOperationException {
  declare readonly code: 'RESTORATION_CONFIRMATION_REQUIRED' | 'RESTORATION_CONFIRMATION_STALE';

  constructor(
    readonly restorableItemCount: number,
    stale: boolean
  ) {
    super(
      409,
      stale ? 'RESTORATION_CONFIRMATION_STALE' : 'RESTORATION_CONFIRMATION_REQUIRED',
      stale
        ? 'The restorable items changed. Review this change again.'
        : `This change clears ${restorableItemCount} restorable ${restorableItemCount === 1 ? 'item' : 'items'}`
    );
  }
}
