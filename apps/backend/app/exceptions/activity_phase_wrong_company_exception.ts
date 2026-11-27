import EntityWriteException from '#exceptions/entity_write_exception'

/** The activity's phase belongs to another company. */
export default class ActivityPhaseWrongCompanyException extends EntityWriteException {
  static code = 'E_ACTIVITY_PHASE_WRONG_COMPANY'
}
