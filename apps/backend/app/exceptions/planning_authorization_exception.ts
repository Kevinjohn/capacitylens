import PlanningOperationException from '#exceptions/planning_operation_exception'

/** The actor may not perform this planning action. */
export default class PlanningAuthorizationException extends PlanningOperationException {
  static status = 403
  static code = 'AUTHORIZATION_DENIED'
  static message = 'This action is not allowed.'
}
