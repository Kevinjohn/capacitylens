import PlanningOperationException from '#exceptions/planning_operation_exception';

/** The operation would leave planning data as it is. */
export default class NoChangeException extends PlanningOperationException {
  static status = 400;
  static code = 'NO_CHANGE';
}
