import EntityWriteException from '#exceptions/entity_write_exception'

/** A project names its client. */
export default class ProjectClientRequiredException extends EntityWriteException {
  static code = 'project_client_required'
}
