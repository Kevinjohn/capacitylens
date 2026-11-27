import EntityWriteException from '#exceptions/entity_write_exception';

/** A project names its client. */
export default class ProjectClientRequiredException extends EntityWriteException {
  static code = 'E_PROJECT_CLIENT_REQUIRED';
}
