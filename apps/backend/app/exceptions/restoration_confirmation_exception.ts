import PlanningOperationException from '#exceptions/planning_operation_exception';

/** Carries only the count required for an explicit, revision-bound cleanup decision. */
export default abstract class RestorationConfirmationException extends PlanningOperationException {
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
