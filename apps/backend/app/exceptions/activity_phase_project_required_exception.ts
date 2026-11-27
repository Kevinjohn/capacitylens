import EntityWriteException from '#exceptions/entity_write_exception'

/** An activity with a phase names that phase’s project. */
export default class ActivityPhaseProjectRequiredException extends EntityWriteException {
  static code = 'E_ACTIVITY_PHASE_PROJECT_REQUIRED'
}
