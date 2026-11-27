import EntityWriteException from '#exceptions/entity_write_exception';

/** A project activity names its project. */
export default class ActivityProjectRequiredException extends EntityWriteException {
  static code = 'E_ACTIVITY_PROJECT_REQUIRED';
}
