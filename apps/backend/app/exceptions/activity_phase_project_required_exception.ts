import EntityWriteException from '#exceptions/entity_write_exception';

/** An activity with a phase names that phase’s project. */
export default class ActivityPhaseProjectRequiredException extends EntityWriteException {
  static code = 'activity_phase_project_required';
}
