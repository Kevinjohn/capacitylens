import PlanningOperationException from '#exceptions/planning_operation_exception'

/** The caller's history holds no step in that direction; nothing was attempted or refused. */
export default class EmptyHistoryException extends PlanningOperationException {
  static status = 409
  static code = 'E_EMPTY_HISTORY'
  static message = 'Nothing to undo or redo.'
}
