import PlanningOperationException from '#exceptions/planning_operation_exception'

/**
 * `E_ACCOUNT_MEMBERSHIP_LOST` is behaviour, not wording: it tells the browser to drop its planning
 * projection, so one sentence and one code answer every lost company membership.
 */
export default class MembershipLostException extends PlanningOperationException {
  static status = 403
  static code = 'E_ACCOUNT_MEMBERSHIP_LOST'
  static message = 'Company membership is unavailable.'
}
