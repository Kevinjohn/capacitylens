import RefusalException from '#exceptions/refusal_exception'

/** The caller's membership is suspended. */
export default class MembershipSuspendedException extends RefusalException {
  static status = 409
  static code = 'E_MEMBERSHIP_SUSPENDED'
  static message =
    'Your membership in this company is suspended. Ask an Owner or Admin to restore it.'
}
