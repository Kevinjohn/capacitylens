import PlanningOperationException from '#exceptions/planning_operation_exception'

/** The record changed after the caller opened it. */
export default class RecordChangedException extends PlanningOperationException {
  static status = 409
  static code = 'E_STALE_REVISION'
  static message = 'The record changed since it was opened.'
}
