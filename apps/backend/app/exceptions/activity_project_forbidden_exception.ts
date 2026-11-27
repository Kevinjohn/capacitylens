import EntityWriteException from '#exceptions/entity_write_exception';

/** An internal or all-projects activity names no project. */
export default class ActivityProjectForbiddenException extends EntityWriteException {
  static code = 'E_ACTIVITY_PROJECT_FORBIDDEN';
}
