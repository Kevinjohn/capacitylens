import EntityWriteException from '#exceptions/entity_write_exception';

/** A phase that has activities stays in its project. */
export default class ActivityPhaseProjectMismatchException extends EntityWriteException {
  static code = 'activity_phase_project_mismatch';
  static message = 'A phase with activities cannot move to a different project.';
}
