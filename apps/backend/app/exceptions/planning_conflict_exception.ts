import PlanningOperationException from '#exceptions/planning_operation_exception';

/** The planning data no longer allows the operation; the sentence names why. */
export default class PlanningConflictException extends PlanningOperationException {
  static status = 409;
}
